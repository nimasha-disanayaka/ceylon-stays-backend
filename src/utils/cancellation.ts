import { PaymentStatus } from '@prisma/client';

export type PolicyTier = 'FULL_REFUND' | 'PARTIAL_REFUND' | 'NON_REFUNDABLE';

export type RefundExecutionStatus =
  | 'PENDING_HOST_PROCESSING'
  | 'NOT_APPLICABLE_NO_PAYMENT'
  | 'NOT_APPLICABLE_NON_REFUNDABLE';

export interface CancellationCalculationResult {
  hoursUntilCheckIn: number;
  refundPercent: number;
  refundAmount: number;
  policyTier: PolicyTier;
  policyDescription: string;
  isEligibleForRefund: boolean;
  refundExecutionStatus: RefundExecutionStatus;
  refundCompleted: boolean;
  targetPaymentStatus: PaymentStatus;
}

/**
 * Calculates refund eligibility, amount, and safe target payment status.
 *
 * Policy:
 * - 5+ days (>= 120 hours) before check-in: 100% refund eligible
 * - 1-5 days (>= 24 hours and < 120 hours) before check-in: 50% refund eligible
 * - < 24 hours before check-in or past check-in: 0% non-refundable
 *
 * Safety Rules:
 * 1. UNPAID bookings remain UNPAID. No refund is ever calculated or marked completed.
 * 2. PAID / CAPTURED bookings awaiting a refund PRESERVE their PAID or CAPTURED status
 *    in the database until actual gateway execution takes place.
 * 3. Never mark REFUNDED or PARTIAL_REFUND in database before confirmed payment provider refund.
 */
export function calculateCancellationRefund(
  checkIn: Date | string,
  totalPrice: number,
  currentPaymentStatus: PaymentStatus,
  referenceTime: Date = new Date()
): CancellationCalculationResult {
  const checkInDate = new Date(checkIn);
  const diffMs = checkInDate.getTime() - referenceTime.getTime();
  const hoursUntilCheckIn = diffMs / (1000 * 60 * 60);

  let refundPercent = 0;
  let policyTier: PolicyTier = 'NON_REFUNDABLE';
  let policyDescription = 'Cancelled within 24 hours of check-in or after check-in';

  if (hoursUntilCheckIn >= 120) {
    refundPercent = 100;
    policyTier = 'FULL_REFUND';
    policyDescription = 'Cancelled 5+ days before check-in (100% refund eligible)';
  } else if (hoursUntilCheckIn >= 24) {
    refundPercent = 50;
    policyTier = 'PARTIAL_REFUND';
    policyDescription = 'Cancelled within 5 days of check-in (50% refund eligible)';
  }

  const refundAmount = Math.round(totalPrice * (refundPercent / 100) * 100) / 100;
  const isEligibleForRefund = refundPercent > 0;

  // Determine execution status and safe target payment status
  let targetPaymentStatus: PaymentStatus = currentPaymentStatus;
  let refundExecutionStatus: RefundExecutionStatus = 'NOT_APPLICABLE_NON_REFUNDABLE';
  const refundCompleted = false; // Never claim completed until gateway confirmation

  if (currentPaymentStatus === PaymentStatus.UNPAID) {
    targetPaymentStatus = PaymentStatus.UNPAID;
    refundExecutionStatus = 'NOT_APPLICABLE_NO_PAYMENT';
  } else if (isEligibleForRefund) {
    // Payment was collected (PAID/CAPTURED) and is eligible for refund.
    // In Zero-Migration mode, preserve current payment status in PostgreSQL
    // so accounting accurately shows funds are still held pending refund processing.
    targetPaymentStatus = currentPaymentStatus;
    refundExecutionStatus = 'PENDING_HOST_PROCESSING';
  } else {
    // Non-refundable: funds remain retained
    targetPaymentStatus = currentPaymentStatus;
    refundExecutionStatus = 'NOT_APPLICABLE_NON_REFUNDABLE';
  }

  return {
    hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
    refundPercent,
    refundAmount,
    policyTier,
    policyDescription,
    isEligibleForRefund,
    refundExecutionStatus,
    refundCompleted,
    targetPaymentStatus,
  };
}
