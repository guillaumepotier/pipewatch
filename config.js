window.PipeWatchConfig = {
  api_token: null,
  default_pipeline_id: 4,
  default_view: 'timeline',
  jail_feature: true,
  admin_users: [
    'andrei@wisembly.com',
    'romain@wisembly.com',
    'guillaume@wisembly.com',
    'arnaud@wisembly.com'
  ],
  unmonitored_users: [
    'charlotte@wisembly.com',
    'charlotte@balloonup.com',
    'christina@balloonup.com',
    'cobalt2760@gmail.com',
    'emmanuel@wisembly.com',
    'romain@balloonup.com',
    'selma@wisembly.com',
    'selma@balloonup.com',
    'sebastien@wisembly.com'
  ],
  timeline_options: {
    amount: [1, 3, 6],    // interval numbers
    start: [0, 1, 3, 6],  // now - amount * monts
    interval: ['month', 'quarter']
  },
  timeline: {
    amount: 6,
    start: 0,
    interval: 'month'
  },
  weighted_filter_percent: 40
};
