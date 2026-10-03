<?php

use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PumpOutbox;
use App\Http\Middleware\RequestTiming;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/*
|--------------------------------------------------------------------------
| Futsal Mate — API bootstrap
|--------------------------------------------------------------------------
|
| This backend is headless: it exists only to serve `/api/*` to the Expo app
| (and, later, other clients). There is no `/` page, no Blade views and no
| session/cookie auth — every request carries the acting player's id.
|
*/

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // The Expo client sends `Content-Type: application/json` but no `Accept`
        // header, so without this Laravel would answer a validation failure with
        // a 302 redirect to a page that doesn't exist instead of a 422 the app
        // can read. Everything on /api is JSON, always.
        $middleware->api(prepend: [
            // Times the request for /api/health, so "the app is slow" has an
            // address before anyone changes a query. Off in production.
            RequestTiming::class,
            ForceJsonResponse::class,
        ]);

        // Emails and game reminders are pumped by API traffic: this deployment
        // has no queue worker and no scheduler, and adding one would break the
        // "git pull, artisan serve, expo start" workflow. See the middleware.
        $middleware->api(append: [
            PumpOutbox::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => true);

        /*
         * Keep the error envelope `{ error: "..." }` because `apiJson()` in
         * the Expo app reads `body.error` to show the server's real message
         * ("That court is already booked for this slot") instead of a generic
         * one.
         */
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($e instanceof ValidationException) {
                $first = collect($e->errors())->flatten()->first();

                return response()->json([
                    'error' => is_string($first) ? $first : $e->getMessage(),
                    'errors' => $e->errors(),
                ], 422);
            }

            $status = 500;

            if ($e instanceof HttpExceptionInterface) {
                $status = $e->getStatusCode();
            }

            $payload = ['error' => $e->getMessage() ?: 'Something went wrong'];

            if (config('app.debug')) {
                $payload['exception'] = $e::class;
                $payload['file'] = $e->getFile().':'.$e->getLine();
            }

            return response()->json($payload, $status ?: 500);
        });
    })->create();
