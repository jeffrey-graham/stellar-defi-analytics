export interface PortfolioTrade {
  asset: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  feeUSD?: number;
  timestamp: number;
}

export interface PortfolioValuationSnapshot {
  timestamp: number;
  value: number;
  netCashFlow?: number;
}

export interface PortfolioPerformance {
  currentValue: number;
  totalInvested: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  roi: number;
  timeWeightedReturn: number | null;
  twrAvailable: boolean;
  history: Array<{
    timestamp: number;
    value: number;
    pnl: number;
  }>;
  positions: Array<{
    asset: string;
    entryPrice: number;
    currentPrice: number;
    quantity: number;
    pnl: number;
    roi: number;
  }>;
  benchmark: {
    hodlValue: number;
    hodlRoi: number;
    outperformance: number;
  };
}

/**
 * Calculate Time-Weighted Return (TWR %) from sub-period return fractions.
 */
export function calculateTimeWeightedReturn(periodReturns: number[]): number {
  if (periodReturns.length === 0) return 0;
  const compounded = periodReturns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  return Number((compounded * 100).toFixed(2));
}

/**
 * Calculate Time-Weighted Return (TWR %) from chronological valuation snapshots
 * at subperiod boundaries, removing the effect of external net cash flows.
 * Returns null when fewer than 2 valid chronological snapshots are available.
 */
export function calculateTWRFromSnapshots(
  snapshots?: PortfolioValuationSnapshot[],
): number | null {
  if (!snapshots || snapshots.length < 2) {
    return null;
  }

  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  const periodReturns: number[] = [];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const startValue = prev.value;
    const endValue = curr.value;
    const netCashFlow = curr.netCashFlow ?? 0;

    if (
      !Number.isFinite(startValue) ||
      !Number.isFinite(endValue) ||
      !Number.isFinite(netCashFlow) ||
      startValue <= 0
    ) {
      return null;
    }

    const periodEndBeforeCashFlow = endValue - netCashFlow;
    if (periodEndBeforeCashFlow < 0) {
      return null;
    }

    const subperiodReturn = (periodEndBeforeCashFlow - startValue) / startValue;
    periodReturns.push(subperiodReturn);
  }

  return calculateTimeWeightedReturn(periodReturns);
}

/**
 * Compute realized/unrealized P&L, ROI, TWR, and HODL benchmark from a trade ledger.
 */
export function computePortfolioFromTrades(
  trades: PortfolioTrade[],
  currentPrices: Record<string, number>,
  hodlEntryPrice = 0.1,
  hodlCurrentPrice = 0.12,
  valuationSnapshots?: PortfolioValuationSnapshot[],
): PortfolioPerformance {
  const holdings: Record<string, { qty: number; costBasis: number; realized: number }> = {};

  for (const t of trades) {
    const fee = t.feeUSD ?? 0;
    const rec = holdings[t.asset] ?? { qty: 0, costBasis: 0, realized: 0 };
    if (t.side === 'buy') {
      rec.qty += t.quantity;
      rec.costBasis += t.quantity * t.price + fee;
    } else if (t.side === 'sell' && rec.qty > 0) {
      const avgEntry = rec.costBasis / rec.qty;
      const soldQty = Math.min(rec.qty, t.quantity);
      rec.realized += soldQty * (t.price - avgEntry) - fee;
      rec.costBasis -= soldQty * avgEntry;
      rec.qty -= soldQty;
    }
    holdings[t.asset] = rec;
  }

  let currentValue = 0;
  let totalInvested = 0;
  let realizedPnL = 0;
  let unrealizedPnL = 0;

  const positions = Object.entries(holdings)
    .filter(([, h]) => h.qty > 0 || h.realized !== 0)
    .map(([asset, h]) => {
      const curPrice = currentPrices[asset] ?? (h.qty > 0 ? h.costBasis / h.qty : 0);
      const entryPrice = h.qty > 0 ? h.costBasis / h.qty : 0;
      const posVal = h.qty * curPrice;
      const posUnrealized = posVal - h.costBasis;
      const posRoi = h.costBasis > 0 ? (posUnrealized / h.costBasis) * 100 : 0;

      currentValue += posVal;
      totalInvested += h.costBasis;
      realizedPnL += h.realized;
      unrealizedPnL += posUnrealized;

      return {
        asset,
        entryPrice: Number(entryPrice.toFixed(4)),
        currentPrice: Number(curPrice.toFixed(4)),
        quantity: Number(h.qty.toFixed(4)),
        pnl: Number(posUnrealized.toFixed(2)),
        roi: Number(posRoi.toFixed(2)),
      };
    });

  const totalPnL = realizedPnL + unrealizedPnL;
  const roi = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
  const twr = calculateTWRFromSnapshots(valuationSnapshots);

  const hodlRoi = hodlEntryPrice > 0 ? ((hodlCurrentPrice - hodlEntryPrice) / hodlEntryPrice) * 100 : 0;
  const hodlValue = totalInvested * (1 + hodlRoi / 100);

  return {
    currentValue: Number(currentValue.toFixed(2)),
    totalInvested: Number(totalInvested.toFixed(2)),
    realizedPnL: Number(realizedPnL.toFixed(2)),
    unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
    totalPnL: Number(totalPnL.toFixed(2)),
    roi: Number(roi.toFixed(2)),
    timeWeightedReturn: twr,
    twrAvailable: twr !== null,
    history: [
      { timestamp: Date.now() - 86_400_000, value: Number(totalInvested.toFixed(2)), pnl: 0 },
      { timestamp: Date.now(), value: Number(currentValue.toFixed(2)), pnl: Number(totalPnL.toFixed(2)) },
    ],
    positions,
    benchmark: {
      hodlValue: Number(hodlValue.toFixed(2)),
      hodlRoi: Number(hodlRoi.toFixed(2)),
      outperformance: Number((roi - hodlRoi).toFixed(2)),
    },
  };
}

export async function calculatePortfolioPerformance(
  walletAddress: string,
  startDate: Date,
  valuationSnapshots?: PortfolioValuationSnapshot[],
): Promise<PortfolioPerformance> {
  if (!walletAddress) {
    throw new Error('walletAddress is required');
  }
  const sampleTrades: PortfolioTrade[] = [
    { asset: 'XLM', side: 'buy', quantity: 10_000, price: 0.1, feeUSD: 1, timestamp: startDate.getTime() },
    { asset: 'USDC', side: 'buy', quantity: 500, price: 1.0, feeUSD: 0.5, timestamp: startDate.getTime() },
  ];
  return computePortfolioFromTrades(
    sampleTrades,
    { XLM: 0.14, USDC: 1.0 },
    0.1,
    0.12,
    valuationSnapshots,
  );
}
