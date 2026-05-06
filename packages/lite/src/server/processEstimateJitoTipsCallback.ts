import { DEFAULT_JITO_TIPS_URL } from "../utils/consts";

export async function processEstimateJitoTipsCallback(
  priority = "landed_tips_75th_percentile",
  url = DEFAULT_JITO_TIPS_URL,
) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Jito tips: ${response.status} ${response.statusText}`,
    );
  }

  const result = await response.json();
  if (
    !Array.isArray(result) ||
    !result[0] ||
    typeof result[0][priority] !== "number"
  ) {
    throw new Error("Invalid Jito tips response format");
  }

  const LAMPORTS_PER_SOL = 1_000_000_000;
  return Math.round(result[0][priority] * LAMPORTS_PER_SOL);
}
