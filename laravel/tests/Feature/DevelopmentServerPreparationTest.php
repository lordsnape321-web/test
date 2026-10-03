<?php

namespace Tests\Feature;

use App\Support\StartupSchema;
use App\Console\Commands\ReconcileBookingPayments;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Support\Facades\Event;
use Mockery;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;
use Tests\TestCase;

class DevelopmentServerPreparationTest extends TestCase
{
    public function test_serve_applies_payment_repair_before_starting(): void
    {
        $schema = Mockery::mock(StartupSchema::class);
        $schema->shouldReceive('ensure')->once();
        $this->app->instance(StartupSchema::class, $schema);

        $command = Mockery::mock(ReconcileBookingPayments::class);
        $command->shouldReceive('setLaravel')->once()->with($this->app);
        $command->shouldReceive('run')->once()
            ->withArgs(fn ($input, $output) => $input->getParameterOption('--apply') === true
                && $output instanceof BufferedOutput)
            ->andReturn(0);
        $this->app->instance(ReconcileBookingPayments::class, $command);

        $output = new BufferedOutput;
        Event::dispatch(new CommandStarting('serve', new ArrayInput([]), $output));
        self::assertStringContainsString('Checking booking payment caches', $output->fetch());
    }

    public function test_other_commands_do_not_access_the_payment_database(): void
    {
        $schema = Mockery::mock(StartupSchema::class);
        $schema->shouldReceive('ensure')->never();
        $this->app->instance(StartupSchema::class, $schema);

        $command = Mockery::mock(ReconcileBookingPayments::class);
        $command->shouldNotReceive('run');
        $this->app->instance(ReconcileBookingPayments::class, $command);

        $output = new BufferedOutput;
        foreach (['list', 'migrate', 'test', 'queue:work', 'bookings:reconcile-payments'] as $name) {
            Event::dispatch(new CommandStarting($name, new ArrayInput([]), $output));
        }
        self::assertSame('', $output->fetch());
    }

    public function test_failed_repair_does_not_silently_start_the_server(): void
    {
        $schema = Mockery::mock(StartupSchema::class);
        $schema->shouldReceive('ensure')->once();
        $this->app->instance(StartupSchema::class, $schema);

        $command = Mockery::mock(ReconcileBookingPayments::class);
        $command->shouldReceive('setLaravel')->once();
        $command->shouldReceive('run')->once()->andReturn(1);
        $this->app->instance(ReconcileBookingPayments::class, $command);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('development server was not started');
        Event::dispatch(new CommandStarting('serve', new ArrayInput([]), new BufferedOutput));
    }
}
