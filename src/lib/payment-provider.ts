import { PaymentMethod, PaymentStatus } from "@prisma/client";

export type SettlementRequest = {
  amount: string;
  idempotencyKey: string;
};

export type PaymentSettlement = {
  method: PaymentMethod;
  status: PaymentStatus;
  provider: string;
  providerRef: string;
  idempotencyKey: string;
};

export interface PaymentProvider {
  readonly method: PaymentMethod;
  settle(request: SettlementRequest): PaymentSettlement;
}

export const cashPaymentProvider: PaymentProvider = {
  method: PaymentMethod.CASH,
  settle: ({ idempotencyKey }) => ({
    method: PaymentMethod.CASH,
    status: PaymentStatus.SUCCEEDED,
    provider: "cash",
    providerRef: idempotencyKey,
    idempotencyKey,
  }),
};
