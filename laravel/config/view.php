<?php

/*
|--------------------------------------------------------------------------
| Views
|--------------------------------------------------------------------------
|
| Blade is used for one thing in this API: the HTML of the emails in
| `resources/views/emails`. Laravel would fall back to its own defaults for a
| missing config file, but the mail path is worth being explicit about — it is
| the difference between "the code never arrived" and "the code was never sent".
|
| `compiled` points at storage/framework/views, which every Laravel install has.
|
*/

return [

    'paths' => [
        resource_path('views'),
    ],

    'compiled' => env(
        'VIEW_COMPILED_PATH',
        realpath(storage_path('framework/views')) ?: storage_path('framework/views')
    ),

];
