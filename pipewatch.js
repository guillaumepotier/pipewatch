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
              this['fetch' + ucfirst(this.view) + 'DealsForUser'].call(this);
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

    fetchPipelineDealsForUser: function (user_id) {
      var
        data = {},
        promises = [],
        stagesStore = { stages: [] }
        store = stagesStore;

      if (!user_id)
        user_id = -1;

      // set current user
      this.currentUser = this.users[this.usersIds[user_id]];

      if (this.hasStore(this.currentUser.id, this.view)) {
        store = this.getStore();

        // If we already have fetched user data, do not make calls
        if (store.stages)
          return this.reflow();

        store = $.extend(store, stagesStore);
      }

      // prepare data that would be sent to API
      if (-1 === user_id)
        data = { everyone: 1 };
      else
        data = { user_id: this.currentUser.id };

      for (var i = 0; i < this.stages.length; i++) {
        $.proxy(function (stage) {
          promises.push(this.api.get('pipeline', $.extend({ id: stage.id }, data))
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
          throw new Error('An error occured while trying to fetch pipeline deals');
        });
    },

    fetchTimelineDealsForUser: function (user_id) {
      var
        data,
        periodsStore = { periods: [] }
        store = periodsStore;

      if (!user_id)
        user_id = -1;

      // set current user
      this.currentUser = this.users[this.usersIds[user_id]];

      if (this.hasStore(this.currentUser.id, this.view)) {
        store = this.getStore();

        // If we already have fetched user data, do not make calls
        if (store.periods)
          return this.reflow();

        store = $.extend(store, periodsStore);
      }

      // prepare data that would be sent to API
      if (-1 !== user_id)
        data = { user_id: this.currentUser.id };

      data = $.extend(data || {}, {
        amount: 6,
        interval: 'month',
        start_date: moment().startOf('month').format('YYYY-MM-DD'),
        stop_date: moment().add('months', 6).endOf('month').format('YYYY-MM-DD'),
        totals_convert_currency: 'default_currency',
        field_key: '60b9edbc627e27ad84d8ace88bc92644bb21b393' // Expected closing date
      });

      return this.api.get('timeline', data)
        .done($.proxy(function (response) {
          for (var period in response.data)
            store.periods.push(response.data[period]);

          this.setStore(store);
          this.reflow();
        }, this))
        .fail(function () {
          throw new Error('An error occured while trying to fetch timeline deals');
        });
    },

    reflow: function () {
      var
        viewMode = ucfirst(this.view),
        calls = [
          'compute' + viewMode + 'Averages',
          'compute' + viewMode + 'Overview',
          'render',
          'analyze' + viewMode
        ];

      for (var i = 0; i < calls.length; i++)
        if ('function' === typeof this[calls[i]])
          this[calls[i]].call(this);

      return this;
    },

    computePipelineAverages: function () {
      var average, sum,
        store = this.getStore();

      // cached store, pipewatch data already computed
      if (store.pipewatch)
        return this;

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

    computePipelineOverview: function () {
      var store = this.getStore();

      // cached store, pipewatch data already computed
      if (store.overview)
        return this;

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

    analyzePipeline: function () {
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

    computeTimelineAverages: function () {
      var
        average,
        sum,
        percent_estimated,
        store = this.getStore();

      // cached store, pipewatch data already computed
      if (store.pipewatch)
        return this;

      for (var i = 0; i < store.periods.length; i++) {
        sum = { deals: store.periods[i].deals.length };
        average = {
          value: store.periods[i].totals_converted.value,
          weighted_value: 0
        };

        for (var j = 0; j < store.periods[i].deals.length; j++) {
          percent_estimated = store.periods[i].deals[j].db99cc66fe5fc443d34081f3d741496aa632e6e2;

          if (percent_estimated === parseInt(percent_estimated, 10) && percent_estimated >= 0 && percent_estimated <= 100)
            average.weighted_value += store.periods[i].deals[j].value * percent_estimated / 100;
        }

        store.periods[i].pipewatch = { sum: $.extend(sum, average) };
      }

      return this;
    },

    render: function () {
      var store = this.getStore();

      this.$element.html('');

      if ($('#' + this.view + '_overview_tpl').length)
        this.$element.append(render(this.view + '_overview_tpl', store.overview))

      if ($('#' + this.view + '_detail_tpl').length)
        this.$element.append(render(this.view + '_detail_tpl', $.extend(true, this, { store: store })));

      $('#pipewatch_select').html(render('select_tpl', this));
      $('#pipewatch_select select').on('change', $.proxy(function () {
        this.view = $('#pipewatch_select select[name="view"]').val();
        this['fetch' + ucfirst(this.view) + 'DealsForUser'].call(this, parseInt($('#pipewatch_select select[name="user"]').val(), 10));
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
      pipeline: 'stages/{id}/deals',
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
