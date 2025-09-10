export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MACD = {
  macd: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
};

