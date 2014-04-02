!(function($) {

  var PipeWatch = function (element, options) {
    this.$element = $(element);
    this.options = $.extend(true, {}, defaults, options);
    this.api = new API(this.options);
    this.store = {};
    this.view = this.options.default_view;

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
              this.fetchDealsForUser();
            }, this));
        }, this));

        return window.PipeWatch = this;
    },

    fetchUsers: function () {
      return this.api.get('users')
        .done($.proxy(function (response) {
          this.users = response.data;
          this.usersIds = {};

          // generate fake everyone user
          this.users.unshift({ id: -1, email: 'everyone@wisembly.com' });

          for (var i = 0; i < this.users.length; i++)
            this.usersIds[this.users[i].id] = i;

        }, this))
        .fail(function () {
          throw new Error('Unable to fetch Pipedrive users');
        });
    },

    getUserByEmail: function (email) {
      for (var i = 0; i < this.users.length; i++)
        if (email === this.users[i].email)
          return this.users[i];

      return;
    },

    fetchStages: function () {
      return this.api.get('stages', { pipeline_id: this.options.pipeline_id })
        .done($.proxy(function (response) {
          this.stages = response.data;
          this.stagesIds = {};

          for (var i = 0; i < this.stages.length; i++)
            this.stagesIds[this.stages[i].id] = i;
        }, this))
        .fail(function () {
          throw new Error('Unable to fetch pipe stages');
        });
    },

    fetchDealsForUser: function (user_id) {
      var promises = [], stage, data = {};

      if (!user_id) {
        user_id = -1;
      }

      // set current user
      this.currentUser = this.users[this.usersIds[user_id]];

      // prepare data that would be sent to API
      if (-1 === user_id)
        data = { everyone: 1 };
      else
        data = { user_id: this.currentUser.id };

      // If we already have fetched user data, do not make calls
      if (this.hasStore(this.currentUser.id, this.view))
        return this.reflow();

      var store = { stages: [] };

      for (var i = 0; i < this.stages.length; i++) {
        $.proxy(function (stage) {
          promises.push(this.api.get('deals', $.extend({ id: stage.id }, data))
            .done($.proxy(function (response) {
              if (null === response.data)
                store.stages[this.stagesIds[stage.id]] = { id: stage.id, deals: [] };
              else
                store.stages[this.stagesIds[stage.id]] = { id: stage.id, deals: response.data };
            }, this))
            .fail(function () {
              throw new Error('Unable to fetch deals for stage #' + id + ' for user #' + this.currentUser.id);
            }));
          }, this)(this.stages[i]);
      }

      return $.when.apply($, promises)
        .done($.proxy(function () {
          this.setStore(store);
          this.reflow();
        }, this))
        .fail(function () {
          throw new Error('An error occured while trying to fetch pipe deals');
        });
    },

    reflow: function () {
      return this.computeAverages()
        .computeOverview()
        .render()
        .analyze();
    },

    computeAverages: function () {
      var average, sum,
        store = this.getStore();

      for (var i = 0; i < store.stages.length; i++) {
        sum = { deals: store.stages[i].deals.length };
        average = {
          value: 0,
          weighted_value: 0,
          time: 0
        };

        for (var j = 0; j < store.stages[i].deals.length; j++) {
          average.value += store.stages[i].deals[j].value;
          average.weighted_value += store.stages[i].deals[j].weighted_value;
          average.time += new Date().getTime() - new Date(store.stages[i].deals[j].stage_change_time).getTime();
        }

        store.stages[i].pipewatch = { sum: $.extend(sum, average) };
        store.stages[i].pipewatch.average = {
          value: sum.deals ? Math.round(average.value / sum.deals, 1) : 0,
          weighted_value: sum.deals ? Math.round(average.weighted_value / sum.deals, 1) : 0,
          velocity: sum.deals ? Math.round(moment.duration(Math.round(average.time / sum.deals)).asDays(), 1) : 0
        };
      }

      return this;
    },

    computeOverview: function () {
      var store = this.getStore();

      store.overview = {
        deals: 0,
        value: 0,
        weighted_value: 0,
        avg_value: 0,
        avg_weighted_value: 0,
        velocity: 0
      };

      for (var i = 1; i < store.stages.length - 1; i++) {
        store.overview.deals += store.stages[i].pipewatch.sum.deals;
        store.overview.value += store.stages[i].pipewatch.sum.value;
        store.overview.weighted_value += store.stages[i].pipewatch.sum.weighted_value;
        store.overview.avg_value += store.stages[i].pipewatch.average.value;
        store.overview.avg_weighted_value += store.stages[i].pipewatch.average.weighted_value;
        store.overview.velocity += store.stages[i].pipewatch.average.velocity;
      }

      store.overview.avg_deals = Math.round(store.overview.deals / store.stages.length, 1);
      store.overview.avg_value = Math.round(store.overview.avg_value / store.stages.length, 1);
      store.overview.avg_weighted_value = Math.round(store.overview.avg_weighted_value / store.stages.length, 1);
      store.overview.velocity = Math.round(store.overview.velocity / store.stages.length, 1);

      return this;
    },

    analyze: function () {
      var store = this.getStore();

      for (var i = 0; i < this.stages.length - 1; i++) {
        // deals
        if (store.stages[i].pipewatch.sum.deals - this.options.analyze.deals.danger < store.stages[i+1].pipewatch.sum.deals)
          $('[data-stage=' + this.stages[i].id + '][data-type="deals"]').addClass('pipe-danger');
        else if (store.stages[i].pipewatch.sum.deals - this.options.analyze.deals.warning < store.stages[i+1].pipewatch.sum.deals)
          $('[data-stage=' + this.stages[i].id + '][data-type="deals"]').addClass('pipe-warning');

        // velocity
        if (store.stages[i].pipewatch.average.velocity > this.options.analyze.velocity.danger)
          $('[data-stage=' + this.stages[i].id + '][data-type="velocity"]').addClass('pipe-danger');
        else if (store.stages[i].pipewatch.average.velocity > this.options.analyze.velocity.warning)
          $('[data-stage=' + this.stages[i].id + '][data-type="velocity"]').addClass('pipe-warning');
      }

      return this;
    },

    render: function () {
      var store = this.getStore();

      this.$element.html('')
        .append(render(this.view + '_overview_tpl', store.overview))
        .append(render(this.view + '_detail_tpl', $.extend(true, this, { store: store })));

      $('#pipewatch_select').html(render('select_tpl', this));
      $('#pipewatch_select select').on('change', $.proxy(function () {
        this.view = $('#pipewatch_select select[name="view"]').val();
        this.fetchDealsForUser($('#pipewatch_select select[name="user"]').val());
      }, this));

      return this;
    },

    hasStore: function (user_id, view) {
      return 'undefined' !== typeof this.store[user_id + view];
    },

    getStore: function () {
      return this.store[this.currentUser.id + this.view];
    },

    setStore: function (value) {
      this.store[this.currentUser.id + this.view] = value;
    }
  };

  $.fn.pipewatch = function (options) {
    new PipeWatch(this, options);
  };

  var defaults = {
    api: 'https://api.pipedrive.com/v1/',
    routes: {
      users: 'users',
      stages: 'stages',
      deals: 'stages/{id}/deals',
      timeline: 'deals/timeline'
    },
    views: [ 'pipeline', 'timeline' ],
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

      return $.ajax($.extend(true, {}, { url: this.generateUrl(this.options.api + this.options.routes[endpoint], queryArgs) }, options))
        .done(function (data) {
          if (data.additional_data && data.additional_data.pagination && true === data.additional_data.pagination.more_items_in_collection)
            throw new Error('more objects in collection, need to implement pagination!');
        });
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


// GLOBALS
function ucfirst (string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Simple JavaScript Templating
// John Resig - http://ejohn.org/ - MIT Licensed
(function(){
  var cache = {};

  this.render = function render (str, data) {
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
