export interface JitoTipsConfig {
  jitoBlockEngineUrl?: string;
  estimateJitoTipsEndpoint?: string;
  priority?:
    | "landed_tips_25th_percentile"
    | "landed_tips_50th_percentile"
    | "landed_tips_75th_percentile"
    | "landed_tips_95th_percentile"
    | "landed_tips_99th_percentile"
    | "ema_landed_tips_50th_percentile";
}
