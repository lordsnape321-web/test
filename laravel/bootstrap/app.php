<?php

use App\Http\Middleware\ForceJsonResponse;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/*
|--------------------------------------------------------------------------
| Futsal Nepal — API bootstrap
|--------------------------------------------------------------------------
|
| This backend is headless: it exists only to serve `/api/*` to the Expo app
| (and, later, the web UI). There is no `/` page, no Blade views and no
| session/cookie auth — every request carries the acting player's id, exactly
| the way the Next.js API it replaces did.
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
            ForceJsonResponse::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => true);

        /*
         * Match the error envelope the Next.js API used — `{ error: "..." }` —
         * because `apiJson()` in the app reads `body.error` to show the server's
         * real message ("That court is already booked for this slot") instead of
         * a generic one.
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
