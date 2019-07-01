import angular from "angular";
import _ from "lodash";
import dateMath from "app/core/utils/datemath";
import kbn from "app/core/utils/kbn";

export class AtlasDatasource {

    constructor(instanceSettings, $q, backendSrv, templateSrv) {
        this.type = instanceSettings.type;
        this.url = instanceSettings.url;
        this.name = instanceSettings.name;
        this.q = $q;
        this.backendSrv = backendSrv;
        this.templateSrv = templateSrv;
        this.atlasFormat = instanceSettings.atlasFormat || 'std.json';
        this.minimumInterval = instanceSettings.minimumInterval || 1000;
    }

    // Required for templating
    metricFindQuery(query) {
        return this.backendSrv.datasourceRequest({
            url: this.url + '/api/v1/tags/' + (query ? this.templateSrv.replaceWithText(query) : 'name'),
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        }).then(this.mapToTextValue);
    }

    metricFind(options) {
        return this.backendSrv.datasourceRequest({
            url: this.url + '/api/v1/tags/name',
            data: options,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        }).then(this.mapToTextValue);
    }

    mapToTextValue(result) {
        return _.map(result.data, (d, i) => {
            return {
                text: d,
                value: i
            };
        });
    }

    metricFindDimensions(options) {
        return this.backendSrv.datasourceRequest({
            url: this.url + '/api/v1/tags?q=name,' + options.target + ',:eq',
            data: options,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        }).then(this.mapToTextValue);
    }

    dimensionFindValues(options, tag) {
        return this.backendSrv.datasourceRequest({
            url: this.url + '/api/v1/tags/' + tag,
            data: options,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        }).then(this.mapToTextValue);
    }

    query(options) {
        var queries = [];
        var _this = this;
        var _scopeTags = _this.templateSrv.variables;
        options.targets.forEach(function(target) {
            if (target.hide || !(target.rawQuery || target.target)) {
                return;
            }
            if (target.rawQueryInput) {
                if (!target.rawQuery) {
                    return;
                }
                var rawQueryParts = [];
                rawQueryParts.push(target.rawQuery);
                if (target.alias) {
                    var legend = target.alias;
                    rawQueryParts.push(legend);
                    rawQueryParts.push(':legend');
                }
                queries.push(rawQueryParts.join(','));
            } else {
                if (!target.target) {
                    return;
                }
                if (target.groupBys) {
                    target.groupBys = target.groupBys.filter(function(groupBy) {
                        return groupBy.name && groupBy.name.length > 0;
                    });
                }
                var queryParts = [];
                queryParts.push("name," + target.target + ",:eq");
                if (_scopeTags) {
                    for (var i = 0; i < _scopeTags.length; i++) {
                        if (_scopeTags[i].current.text != 'All') {
                            queryParts.push(_scopeTags[i].name + "," + _scopeTags[i].current.text + ",:eq,:and");
                        }
                    }
                }
                var hasPushAggregation = false;
                if (target.tags) {
                    var logicals = [];
                    for (var i = 0, len = target.tags.length; i < len; i++) {
                      var aTag = target.tags[i];
                      var valueReplaced = _this.templateSrv.replace(aTag.value);
                      // the replaced value for templates will be a comma separated list
                      if (valueReplaced.includes(',')) {
                          len = valueReplaced.length;
                          valueReplaced = valueReplaced.replace('{','');
                          valueReplaced = valueReplaced.replace('}','');
                          var multipleValues = valueReplaced.split(',');
                          for (var mvIndex = 0, mvLen = multipleValues.length; mvIndex < mvLen; mvIndex++) {
                            // queryParts.push(aTag.name);
                            if ("xxxin" === aTag.matcher) {
                              //if (target.aggregation) {
                              //    queryParts.push(":" + target.aggregation);
                              //}
                              queryParts.push(aTag.name);
                              queryParts.push("(");
                              queryParts.push(multipleValues[mvIndex]);
                              queryParts.push(")");
                              queryParts.push(":in");
                            }
                            else {
                              queryParts.push(aTag.name);
                              queryParts.push(multipleValues[mvIndex]);
                              queryParts.push(":" + aTag.matcher);
                            }
                            if ("not" === aTag.notCondition) {
                                queryParts.push(":not");
                            }
                            logicals.push(":" + aTag.logical);
                          }
                      } else {
                        // queryParts.push(aTag.name);
                        if ("in" === aTag.matcher) {
                          // no logicals associated with this matcher

                          // legend must come before this matcher
                          // aggregation must come before this matcher, so the name must be pushed after
                          if (target.aggregation) {
                              hasPushAggregation = true;
                              queryParts.push(":" + target.aggregation);
                          }
                          queryParts.push(aTag.name);
                          queryParts.push("(");
                          queryParts.push(valueReplaced);
                          queryParts.push(")");
                          queryParts.push(":in");
                        }
                        else {
                          queryParts.push(aTag.name);
                          queryParts.push(valueReplaced);
                          queryParts.push(":" + aTag.matcher);
                        }
                        if ("not" === aTag.notCondition) {
                            queryParts.push(":not");
                        }
                        if ("in" === aTag.matcher) {
                           // logicals go before "in"
                        } else {
                          logicals.push(":" + aTag.logical);
                        }
                      }
                    }
                    queryParts = queryParts.concat(logicals.reverse());
                }
                if (target.aggregation && !hasPushAggregation) {
                   queryParts.push(":" + target.aggregation);
                }
                if (target.groupBys && target.groupBys.length > 0) {
                    queryParts.push("(");
                    target.groupBys.forEach(function(groupBy) {
                        queryParts.push(groupBy.name);
                    });
                    queryParts.push(")");
                    queryParts.push(":by");
                }

                if (target.alias) {
                    var aliasLegend = target.alias;
                    if (target.groupBys && target.groupBys.length > 0) {
                        var legendSuffixValue = _.map(target.groupBys,
                                function(groupBy) {
                                    return ' $' + groupBy.name;
                                })
                            .join(' ');
                        aliasLegend += ' ' + legendSuffixValue;
                    }
                    queryParts.push(aliasLegend);
                    queryParts.push(':legend');
                }

                queries.push(queryParts.join(','));
            }
        });
        // Atlas can take multiple concatenated stack queries
        var fullQuery = queries.join(',');

        var interval = options.interval;
        if (kbn.interval_to_ms(interval) < this.minimumInterval) {
            // console.log("Detected interval smaller than allowed: " + interval);
            interval = kbn.secondsToHms(this.minimumInterval / 1000);
            // console.log("New Interval: " + interval);
        }

        /*
                var params = {
                    q: fullQuery,
                    step: interval,
                    s: options.rangeRaw.from,
                    e: options.rangeRaw.to,
                    format: this.atlasFormat
                };
        */

        var params = {
            q: fullQuery,
            step: interval,
            s: options.range.from.valueOf(),
            e: options.range.to.valueOf(),
            format: this.atlasFormat
        };

        var httpOptions = {
            method: 'GET',
            url: this.url + '/api/v1/graph',
            params: params,
            headers: {
                'Content-Type': 'application/json',
            },
            inspect: {
                type: 'atlas'
            }
        };
        // console.log("before defer");
        var deferred = this.q.defer();
        // var _this = this;
        this.backendSrv.datasourceRequest(httpOptions)
            .then(function(response) {
                if (response.status !== 200) {
                    console.log("error...");
                    var error = new Error("Bad Status: " + response.status);
                    deferred.reject(error);
                }
                if (!response.data) {
                    var responseError = new Error("No data");
                    deferred.reject(responseError);
                }
                deferred.resolve(_this.convertToTimeseries(response.data));
            }, function(response) {
                console.error('Unable to load data. Response: %o', response.data ? response.data.message : response);
                var error = new Error("Unable to load data");
                deferred.reject(error);
            });

        return deferred.promise;
    }

    convertToTimeseries(result) {
        // console.log("inside convertToTimeseries");
        var timeseriesData = _.map(result.legend, function(legend, index) {
            var series = {
                target: legend,
                datapoints: []
            };
            if (legend.indexOf('NO DATA') > 0 || legend.indexOf('NO_DATA') > 0) {
                series.allIsNull = true;
                return series;
            }

           // var values = _.pluck(result.values, index);
		    var a = result.values;
		    var values = a[index];
            var notAllZero = false;
            var notAllNull = false;
            for (var i = 0; i < values.length; i++) {
                var value = values[i];
                var timestamp = result.start + (i * result.step);
                series.datapoints.push([value, timestamp]);
                notAllZero = notAllZero || value !== 0;
                notAllNull = notAllNull || (value !== "NaN" && value !== undefined);
            }
            //hide zero and null results
            series.allIsZero = !notAllZero;
            series.allIsNull = !notAllNull;
            return series;
        });
        return {
            data: timeseriesData
        };
    }

    // Required
    // Used for testing datasource in datasource configuration pange
    testDatasource() {
        return this.backendSrv.datasourceRequest({
            url: this.url + '/api/v1/tags',
            method: 'GET',
        }).then(response => {
            if (response.status === 200) {
                return {
                    status: "success",
                    message: "Data source is working",
                    title: "Success"
                };
            }
        });
    }
}
