// Решение рекомендательной системы (раздел 10.4 ТЗ)
export type Decision = "BUY" | "WAIT" | "UNCERTAIN" | "INSUFFICIENT_DATA";

// Одна точка истории цен
export interface PricePoint {
  ts: number; // unix ms
  price: number;
}