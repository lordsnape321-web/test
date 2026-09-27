<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Treat every /api request as a JSON request.
 *
 * Laravel decides how to answer a failed request by looking at the `Accept`
 * header. The Expo client (see `src/lib/api.ts` in the app) does not set one —
 * it only sets `Content-Type` when it has a body — so a validation failure
 * would come back as a 302 redirect to `/`, which `fetch()` follows and then
 * fails to parse as JSON. Forcing `Accept: application/json` on the way in
 * makes every error a readable 4xx/5xx JSON body instead.
 */
class ForceJsonResponse
{
    /**
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set('Accept', 'application/json');

        return $next($request);
    }
}
