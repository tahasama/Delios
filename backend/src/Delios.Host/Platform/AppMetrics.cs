using Prometheus;

namespace Delios.Host.Platform;

/// <summary>
/// Measurements only the application can take. Alert rules in
/// deploy/monitoring/alerts.yml read them; their names are part of that contract.
/// </summary>
public static class AppMetrics
{
    public static readonly Gauge OutboxUnsent = Metrics.CreateGauge(
        "delios_outbox_unsent_messages", "Committed messages not yet handed to RabbitMQ.");

    public static readonly Gauge OutboxOldestUnsentSeconds = Metrics.CreateGauge(
        "delios_outbox_oldest_unsent_seconds", "Age of the oldest message waiting in the outbox.");

    public static readonly Counter FilesProcessed = Metrics.CreateCounter(
        "delios_files_processed_total", "Files the worker finished, by outcome.",
        new CounterConfiguration { LabelNames = ["status"] });

    public static readonly Histogram FileProcessingSeconds = Metrics.CreateHistogram(
        "delios_file_processing_seconds", "Time to read, scan and verify one file.",
        new HistogramConfiguration { Buckets = Histogram.ExponentialBuckets(0.05, 2, 14) });

    public static readonly Counter FileMessagesFailed = Metrics.CreateCounter(
        "delios_file_messages_failed_total", "File messages that failed, by what happened next.",
        new CounterConfiguration { LabelNames = ["outcome"] });

    public static readonly Histogram RegisterQuerySeconds = Metrics.CreateHistogram(
        "delios_register_query_seconds", "Time to answer one register page, search included.",
        new HistogramConfiguration
        {
            LabelNames = ["search"],
            Buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
        });
}
