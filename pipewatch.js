!(function($) {

  var PipeWatch = function (element, options) {
    this.$element = $(element);
    this.options = $.extend(true, {}, defaults, options);
    this.api = new API(this.options);
    this.store = {};
    this.view = this.options.default_view;

    this.isAdmin = !this.options.jail_feature || ('undefined' !== typeof this.options.api_token && null !== this.options.api_token);

    this.loggedInUser = { id: -1, email: null };

    if (!moment)
      throw new Error('Moment is required');

    if (!window.PipeWatch)
      this.init();
  };

  PipeWatch.prototype = {
    init: function () {
      if (!this.options.api_token || null === this.options.api_token)
        this.authenticate();
      else
        this.fetchPipelines()
          .done($.proxy(function () {
            this.fetchUsers()
              .done($.proxy(function () {
                this.fetchStages()
                  .done($.proxy(function () {
                    this['fetch' + ucfirst(this.view) + 'DealsForUser'].call(this, this.loggedInUser.id);
                  }, this));
              }, this));
          }, this));

        if (!window.PipeWatch)
          window.PipeWatch = this;

        return this;
    },

    authenticate: function () {
      this.$element.html('')
        .append(render('authenticate_tpl'))
        .find('form')
        .on('submit', $.proxy(function (e) {
          e.preventDefault();

          var form = {
            email: $('#pipewatch_email').val().trim(),
            password: $('#pipewatch_password').val().trim()
          };

          this.api.post('authenticate', form)
            .done($.proxy(function (response) {
              if (this.options.jail_feature && -1 !== this.options.admin_users.indexOf(response.additional_data.user.profile.email))
                this.isAdmin = true;

              this.loggedInUser = {
                id: response.additional_data.user.profile.id,
                email: response.additional_data.user.profile.email
              };

              this.options.api_token = response.data[0].api_token;
              this.init();
            }, this))
            .fail(function (xhr, status, response) {
              throw new Error('Failed authenticate call. Reasons: ' + response);
            });
        }, this));
    },

    fetchPipelines: function () {
      return this.api.get('pipelines')
        .done($.proxy(function (response) {
          this.pipelines = response.data;

          for (var i = 0; i < this.pipelines.length; i++) {
            if (this.options.default_pipeline_id === this.pipelines[i].id) {
              this.currentPipeline = this.pipelines[i];
              break;
            }
          }
        }, this))
        .fail(function () {
          throw new Error('Unable to fetch Pipedrive pipelines');
        });
    },

    fetchUsers: function () {
      return this.api.get('users')
        .done($.proxy(function (response) {
          this.users = response.data;

          if (this.options.unmonitored_users.length)
            this.users = this.users.filter($.proxy(function (user) {
              return -1 === this.options.unmonitored_users.indexOf(user.email);
            }, this));

          // sort users array email DESC
          this.users.sort(function (a, b) {
            if (a.email === b.email)
              return 0;

            return a.email > b.email ? 1 : -1;
          });

          // generate fake everyone user
          this.users.unshift({ id: -1, email: 'everyone@wisembly.com' });

          // generate users dictionary
          this.usersIds = {};
          for (var i = 0; i < this.users.length; i++)
            this.usersIds[this.users[i].id] = i;

        }, this))
        .fail(function () {
          throw new Error('Unable to fetch Pipedrive users');
        });
    },

    fetchStages: function () {
      return this.api.get('stages', { pipeline_id: this.currentPipeline.id })
        .done($.proxy(function (response) {
          this.stagesPipeId = this.currentPipeline.id;
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
        stagesStore = { stages: [] },
        store = stagesStore;

      if (!user_id)
        user_id = -1;

      // set current user
      this.currentUser = this.users[this.usersIds[user_id]];

      if (this.hasStore()) {
        store = this.getStore();

        // If we already have fetched user data, do not make calls
        if (store.stages)
          return this.reflow();

        store = $.extend(store, stagesStore);
      }

      // we need to fetch again stages for this new pipeline
      if (this.stagesPipeId !== this.currentPipeline.id) {
        this.fetchStages()
          .done($.proxy(function () {
            this.fetchPipelineDealsForUser(user_id);
          }, this));
        return;
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
        store = { periods: [] };

      if (!user_id)
        user_id = -1;

      // set current user
      this.currentUser = this.users[this.usersIds[user_id]];

      // prepare data that would be sent to API
      if (-1 !== user_id)
        data = { user_id: this.currentUser.id };

      data = $.extend(data || {}, {
        amount: this.options.timeline.amount,
        interval: this.options.timeline.interval,
        pipeline_id: this.currentPipeline.id,
        start_date: moment().subtract('month', this.options.timeline.start).startOf('month').format('YYYY-MM-DD'),
        totals_convert_currency: 'default_currency',
        field_key: '60b9edbc627e27ad84d8ace88bc92644bb21b393' // Expected closing date
      });

      // If we already have fetched user data, do not make calls
      if (this.hasStore()) {
        store = this.getStore();

        return this.reflow();
      }

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
          'compute' + viewMode + 'Details',
          'compute' + viewMode + 'Overview',
          'render',
          'analyze' + viewMode
        ];

      for (var i = 0; i < calls.length; i++)
        if ('function' === typeof this[calls[i]])
          this[calls[i]].call(this);

      return this;
    },

    computePipelineDetails: function () {
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

      for (var i = 0; i < store.stages.length; i++) {
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

    computeTimelineDetails: function () {
      var
        average,
        sum,
        percent_estimated,
        store = this.getStore();

      // cached store, pipewatch data already computed
      if (store.pipewatch)
        return this;

      for (var i = 0; i < store.periods.length; i++) {
        sum = {
          deals: store.periods[i].deals.length,
          monthly_closing: 0
        };
        average = {
          value: store.periods[i].totals_converted.value,
          won_value: store.periods[i].totals_converted.won_value,
          weighted_value: 0
        };

        for (var j = 0; j < store.periods[i].deals.length; j++) {
          percent_estimated = store.periods[i].deals[j].db99cc66fe5fc443d34081f3d741496aa632e6e2;

          if (!store.periods[i].deals[j].active) {
            average.weighted_value += store.periods[i].deals[j].value;

            if (moment(store.periods[i].period_start).month() === moment(store.periods[i].deals[j].add_time).month()) {
              sum.monthly_closing += store.periods[i].deals[j].value;
            }
          } else if (percent_estimated === parseInt(percent_estimated, 10) && percent_estimated >= 0 && percent_estimated <= 100)
            average.weighted_value += store.periods[i].deals[j].value * percent_estimated / 100;
        }

        store.periods[i].pipewatch = { sum: $.extend(sum, average) };
      }

      store.pipewatch = true;

      return this;
    },

    render: function () {
      var store = this.getStore();

      this.$element.html('');

      if ($('#' + this.view + '_overview_tpl').length)
        this.$element.append(render(this.view + '_overview_tpl', store.overview));

      if ($('#' + this.view + '_detail_tpl').length)
        this.$element.append(render(this.view + '_detail_tpl', $.extend(true, {}, this, { store: store })));

      if (!$('#pipewatch_select select').length) {
        $('#pipewatch_select').html(render('select_tpl', this));
        $('#pipewatch_select select').on('change', $.proxy(function () {
          this.view = $('#pipewatch_select select[name="view"]').val();
          this.currentPipeline = this.pipelines[$('#pipewatch_select select[name="pipeline"]').val()];
          this['fetch' + ucfirst(this.view) + 'DealsForUser'].call(this, parseInt($('#pipewatch_select select[name="user"]').val(), 10));
        }, this));
      }

      if ('timeline' === this.view) {
        $('#pipewatch_timeline_select select').on('change', $.proxy(function () {
          this.options.timeline.amount = parseInt($('#pipewatch_timeline_select select[name="amount"]').val(), 10);
          this.options.timeline.interval = $('#pipewatch_timeline_select select[name="interval"]').val();
          this.options.timeline.start = parseInt($('#pipewatch_timeline_select select[name="start"]').val(), 10);
          this.fetchTimelineDealsForUser(parseInt($('#pipewatch_select select[name="user"]').val(), 10));
        }, this));
      }

      return this;
    },

    hasStore: function () {
      return 'undefined' !== typeof this.store[this._storeKey()];
    },

    getStore: function () {
      return this.store[this._storeKey()];
    },

    setStore: function (value) {
      this.store[this._storeKey()] = value;
    },

    _storeKey: function () {
      if ('pipeline' === this.view)
        return 'pipeline' + this.currentUser.id + 'pipeline-' + this.currentPipeline.id;

      if ('timeline' === this.view)
        return 'timeline' + this.currentUser.id + 'pipeline-' + this.currentPipeline.id + $.param(this.options.timeline);
    }
  };

  $.fn.pipewatch = function (options) {
    new PipeWatch(this, options);
  };

  var defaults = {
    api: 'https://api.pipedrive.com/v1/',
    routes: {
      authenticate: 'authorizations',
      users: 'users',
      stages: 'stages',
      pipeline: 'stages/{id}/deals',
      pipelines: 'pipelines',
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
            console.warn('more objects in collection, need to implement pagination!');
        });
    },

    post: function(endpoint, requestArgs, options) {
      if (!this.options.routes[endpoint])
        throw new Error('Unknown endpoint');

      return $.ajax($.extend(true, { method: 'POST', data: requestArgs, url: this.generateUrl(this.options.api + this.options.routes[endpoint]) }, options));
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

// lte IE8 compatibility
// https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Array/indexOf
if (!Array.prototype.indexOf)
  Array.prototype.indexOf = function (searchElement /*, fromIndex */ ) {
    "use strict";
    if (this === null) {
        throw new TypeError();
    }
    var t = Object(this);
    var len = t.length >>> 0;
    if (len === 0) {
        return -1;
    }
    var n = 0;
    if (arguments.length > 1) {
        n = Number(arguments[1]);
        if (n != n) { // shortcut for verifying if it's NaN
            n = 0;
        } else if (n !== 0 && n != Infinity && n != -Infinity) {
            n = (n > 0 || -1) * Math.floor(Math.abs(n));
        }
    }
    if (n >= len) {
        return -1;
    }
    var k = n >= 0 ? n : Math.max(len - Math.abs(n), 0);
    for (; k < len; k++) {
        if (k in t && t[k] === searchElement) {
            return k;
        }
    }
    return -1;
  };
