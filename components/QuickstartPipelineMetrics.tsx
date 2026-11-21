'use client';

export type QuickstartAgentMetric = {
  type: string;
  name: string;
  value: number;
  timestamp: number;
};

type QuickstartPipelineMetricsProps = {
  metrics: QuickstartAgentMetric[];
};

const PIPELINE = [
  { key: 'stt', label: 'Deepgram STT', metricTypes: ['stt', 'asr'] },
  { key: 'llm', label: 'OpenAI LLM', metricTypes: ['llm', 'mllm'] },
  { key: 'tts', label: 'MiniMax TTS', metricTypes: ['tts'] },
] as const;

function formatMetricName(name: string) {
  return name.replace(/[_-]+/g, ' ');
}

export function QuickstartPipelineMetrics({
  metrics,
}: QuickstartPipelineMetricsProps) {
  const latestByType = new Map<string, QuickstartAgentMetric>();
  for (const metric of metrics) {
    latestByType.set(metric.type.toLowerCase(), metric);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-sm font-medium leading-6 text-muted-foreground">
        Pipeline
      </span>
      {PIPELINE.map((step, index) => {
        const metric = step.metricTypes
          .map((type) => latestByType.get(type))
          .find(Boolean);

        return (
          <div key={step.key} className="flex items-center gap-2">
            {index > 0 && (
              <span className="text-xs text-muted-foreground" aria-hidden="true">
                /
              </span>
            )}
            <span className="rounded-full border border-border bg-transparent px-2.5 py-0.5 font-mono text-[11px] font-medium leading-4 text-foreground">
              {step.label}
              {metric && (
                <span
                  className="ml-2 text-primary"
                  title={new Date(metric.timestamp).toLocaleTimeString()}
                >
                  {formatMetricName(metric.name)} {Math.round(metric.value)}ms
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
