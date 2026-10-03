<?php

namespace App\Providers;

use App\Console\Commands\ReconcileBookingPayments;
use App\Support\StartupSchema;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Support\ServiceProvider;
use Symfony\Component\Console\Input\ArrayInput;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Prepare only the explicitly started development server, never normal
        // HTTP requests, queue workers, migrations or unrelated Artisan commands.
        // No cache marker: the configured database may change between starts.
        $this->app['events']->listen(CommandStarting::class, function (CommandStarting $event): void {
            if ($event->command !== 'serve') {
                return;
            }

            $this->app->make(StartupSchema::class)->ensure($event->output);

            $event->output->writeln('<info>Checking booking payment caches against saved receipts...</info>');
            $command = $this->app->make(ReconcileBookingPayments::class);
            $command->setLaravel($this->app);

            // Invoke the command directly instead of recursively starting the
            // Artisan application while its serve command is being dispatched.
            $status = $command->run(new ArrayInput(['--apply' => true]), $event->output);
            if ($status !== 0) {
                throw new \RuntimeException('Payment cache repair failed; the development server was not started.');
            }
        });
    }
}
