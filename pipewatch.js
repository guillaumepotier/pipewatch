!(function($) {

  var PipeWatch = function (element, options) {
    this.$element = $(element);
    this.options = $.extend(true, {}, defaults, options);
    this.api = new API(this.options);

    if (!moment)
      throw new Error('Moment is required');

    if (!window.PipeWatch)
      this.init();
  };

  PipeWatch.prototype = {
    init: function () {
      this.fetchUsers()
        .done($.proxy(function () {
          this.fetchStages()
            .done($.proxy(function () {
              this.fetchDealsForUser(this.options.default_user_id);
            }, this));
        }, this));

        return window.PipeWatch = this;
    },

    fetchUsers: function () {
      return this.api.get('users')
        .done($.proxy(function (response) {
          this.users = response.data;
          this.usersIds = {};

          for (var i = 0; i < this.users.length; i++)
            this.usersIds[this.users[i].id] = i;

        }, this))
        .fail(function () {
          throw new Error('Unable to fetch Pipedrive users');
        });
    },

    fetchStages: function () {
      return this.api.get('stages', { pipeline_id: this.options.pipeline_id })
        .done($.proxy(function (response) {
          this.stages = response.data;
          this.stagesIds = {};

          for (var i = 0; i < this.stages.length; i++)
            this.stagesIds[this.stages[i].id] = i;

          this.fetchDealsForUser(this.options.default_user_id);
        }, this))
        .fail(function () {
          throw new Error('Unable to fetch pipe stages');
        });
    },

    fetchDealsForUser: function (user_id) {
      var promises = [], stage;

      this.currentUser = this.users[this.usersIds[user_id]];

      for (var i = 0; i < this.stages.length; i++) {
        $.proxy(function (stage) {
          promises.push(this.api.get('deals', { id: stage.id, user_id: user_id })
            .done($.proxy(function (response) {
              if (null === response.data)
                this.stages[this.stagesIds[stage.id]].deals = [];
              else
                this.stages[this.stagesIds[stage.id]].deals = response.data;
            }, this))
            .fail(function () {
              throw new Error('Unable to fetch deals for stage #' + id + ' for user #' + user_id);
            }));
          }, this)(this.stages[i]);
      }

      return $.when.apply($, promises)
        .done($.proxy(function () {
          this.computeAverages()
            .computeOverview()
            .analyze()
            .render()
            .analyze();
        }, this))
        .fail(function () {
          throw new Error('An error occured while trying to fetch pipe deals');
        });
    },

    computeAverages: function () {
      var average, sum;

      for (var i = 0; i < this.stages.length; i++) {
        sum = { deals: this.stages[i].deals.length };
        average = {
          value: 0,
          weighted_value: 0,
          time: 0
        };

        for (var j = 0; j < this.stages[i].deals.length; j++) {
          average.value += this.stages[i].deals[j].value;
          average.weighted_value += this.stages[i].deals[j].weighted_value;
          average.time += new Date().getTime() - new Date(this.stages[i].deals[j].add_time).getTime();
        }

        this.stages[i].pipewatch = { sum: $.extend(sum, average) };
        this.stages[i].pipewatch.average = {
          value: Math.round(average.value / sum.deals, 1),
          weighted_value: Math.round(average.weighted_value / sum.deals, 1),
          velocity: Math.round(moment.duration(Math.round(average.time / sum.deals)).asDays(), 1)
        };
      }

      return this;
    },

    computeOverview: function () {
      this.overview = {
        deals: 0,
        value: 0,
        weighted_value: 0,
        avg_value: 0,
        avg_weighted_value: 0,
        velocity: 0
      };

      for (var i = 0; i < this.stages.length; i++) {
        this.overview.deals += this.stages[i].pipewatch.sum.deals;
        this.overview.value += this.stages[i].pipewatch.sum.value;
        this.overview.weighted_value += this.stages[i].pipewatch.sum.weighted_value;
        this.overview.avg_value += this.stages[i].pipewatch.average.value;
        this.overview.avg_weighted_value += this.stages[i].pipewatch.average.weighted_value;
        this.overview.velocity += this.stages[i].pipewatch.average.velocity;
      }

      this.overview.avg_deals = Math.round(this.overview.deals / this.stages.length, 1);
      this.overview.avg_value = Math.round(this.overview.avg_value / this.stages.length, 1);
      this.overview.avg_weighted_value = Math.round(this.overview.avg_weighted_value / this.stages.length, 1);
      this.overview.velocity = Math.round(this.overview.velocity / this.stages.length, 1);

      return this;
    },

    analyze: function () {
      for (var i = 0; i < this.stages.length - 1; i++) {
        // deals
        if (this.stages[i].pipewatch.sum.deals - this.options.analyze.deals.danger < this.stages[i+1].pipewatch.sum.deals)
          $('[data-stage=' + this.stages[i].id + '][data-type="deals"]').addClass('pipe-danger');
        else if (this.stages[i].pipewatch.sum.deals - this.options.analyze.deals.warning < this.stages[i+1].pipewatch.sum.deals)
          $('[data-stage=' + this.stages[i].id + '][data-type="deals"]').addClass('pipe-warning');

        // velocity
        if (this.stages[i].pipewatch.average.velocity > this.options.analyze.velocity.danger)
          $('[data-stage=' + this.stages[i].id + '][data-type="velocity"]').addClass('pipe-danger');
        else if (this.stages[i].pipewatch.average.velocity > this.options.analyze.velocity.warning)
          $('[data-stage=' + this.stages[i].id + '][data-type="velocity"]').addClass('pipe-warning');
      }

      return this;
    },

    render: function () {
      this.$element.html('')
        .append(render('overview_tpl', this.overview))
        .append(render('stages_tpl', this));

      $('#pipewatch_select').html(render('select_tpl', this));
      $('#pipewatch_select select').on('change', $.proxy(function () {
        this.fetchDealsForUser($('#pipewatch_select select').val());
      }, this));

      return this;
    }
  };

  $.fn.pipewatch = function (options) {
    new PipeWatch(this, options);
  };

  var defaults = {
    api: 'https://api.pipedrive.com/v1/',
    routes: {
      users: 'users',
      stages: 'stages?pipeline_id={pipeline_id}',
      deals: 'stages/{id}/deals'
    },
    analyze: {
      deals: {
        danger: 1,
        warning: 3
      },
      velocity: {
        danger: 90,
        warning: 60
      }
    }
  };

  var API = function (options) {
    this.options = options;
  };

  API.prototype = {
    get: function (endpoint, queryArgs, options) {
      if (!this.options.routes[endpoint])
        throw new Error('Unknown endpoint');

      return $.ajax($.extend(true, {}, { url: this.generateUrl(this.options.api + this.options.routes[endpoint], queryArgs) }, options));
    },

    generateUrl: function (url, queryArgs) {
      queryArgs = $.extend(true, queryArgs, { api_token: this.options.api_token });

      for (var key in queryArgs) {
        if (-1 !== url.indexOf('{' + key + '}')) {
          url = url.replace('{' + encodeURIComponent(key) + '}', encodeURIComponent(queryArgs[key]));
        } else {
          if (-1 !== url.indexOf('?'))
            url += '&';
          else
            url += '?';

          url += encodeURIComponent(key) + '=' + encodeURIComponent(queryArgs[key]);
        }
      }

      return url;
    }
  };

})(window.jQuery);

// Simple JavaScript Templating
// John Resig - http://ejohn.org/ - MIT Licensed
(function(){
  var cache = {};

  this.render = function render(str, data){
    // Figure out if we're getting a template, or if we need to
    // load the template - and be sure to cache the result.
    var fn = !/\W/.test(str) ?
      cache[str] = cache[str] ||
        render(document.getElementById(str).innerHTML) :

      // Generate a reusable function that will serve as a template
      // generator (and which will be cached).
      new Function("obj",
        "var p=[],print=function(){p.push.apply(p,arguments);};" +

        // Introduce the data as local variables using with(){}
        "with(obj){p.push('" +

        // Convert the template into pure JavaScript
        str
          .replace(/[\r\t\n]/g, " ")
          .split("<%").join("\t")
          .replace(/((^|%>)[^\t]*)'/g, "$1\r")
          .replace(/\t=(.*?)%>/g, "',$1,'")
          .split("\t").join("');")
          .split("%>").join("p.push('")
          .split("\r").join("\\'")
        + "');}return p.join('');");

    // Provide some basic currying to the user
    return data ? fn(data) : fn;
  };
})();
