ALTER TABLE "Order"
ADD CONSTRAINT "Order_giftCardRedeemed_check"
CHECK (
    "giftCardRedeemed" >= 0
    AND "giftCardRedeemed" <= "total"
    AND ("giftCardRedeemed" = 0 OR "giftCardId" IS NOT NULL)
);

ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_cashRefundAmount_check"
CHECK ("cashRefundAmount" >= 0 AND "cashRefundAmount" <= "amount");

ALTER TABLE "GiftCard"
ADD CONSTRAINT "GiftCard_initialBalance_check"
CHECK ("initialBalance" > 0),
ADD CONSTRAINT "GiftCard_balance_check"
CHECK ("balance" >= 0);

ALTER TABLE "GiftCardTransaction"
ADD CONSTRAINT "GiftCardTransaction_amountDelta_check"
CHECK (
    ("type" = 'REDEEM' AND "amountDelta" < 0)
    OR ("type" IN ('ISSUE', 'REFUND') AND "amountDelta" > 0)
),
ADD CONSTRAINT "GiftCardTransaction_reference_check"
CHECK (
    ("type" = 'ISSUE' AND "orderId" IS NULL AND "refundId" IS NULL)
    OR ("type" = 'REDEEM' AND "orderId" IS NOT NULL AND "refundId" IS NULL)
    OR ("type" = 'REFUND' AND "orderId" IS NULL AND "refundId" IS NOT NULL)
);
