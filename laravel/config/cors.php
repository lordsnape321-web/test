<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | The Expo app runs on a different origin than this API — on the web it is
    | the Metro dev server (http://localhost:8081), on a phone it is the device
    | itself. Every route therefore has to answer the browser's preflight and
    | carry `Access-Control-Allow-Origin`, or the web build cannot reach the
    | backend at all.
    |
    | Set CORS_ALLOWED_ORIGINS to a comma-separated list to lock this down in
    | production, e.g. "https://app.futsalnepal.com".
    |
    */

    'paths' => ['api/*', 'up'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', '*'))
    ))) ?: ['*'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    // The app authenticates with values in the request body / AsyncStorage, not
    // cookies, so credentials are deliberately not supported here.
    'supports_credentials' => false,

];
