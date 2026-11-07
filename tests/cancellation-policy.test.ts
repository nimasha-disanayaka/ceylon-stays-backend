import { calculateCancellationRefund } from '../src/utils/cancellation';
import { PaymentStatus } from '@prisma/client';

describe('Cancellation and Refund Policy Safety Tests (Approach A: Zero-Migration)', () => {
  const BASE_PRICE = 200.0;
  const NOW = new Date('2026-11-10T12:00:00Z');

  describe('1. Full Refund Tier (5+ days / >= 120 hours before check-in)', () => {
    it('should calculate 100% refund eligibility 6 days before check-in without prematurely marking REFUNDED', () => {
      const checkIn = new Date('2026-11-16T12:00:00Z'); // 144 hours ahead
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.PAID, NOW);

      expect(result.policyTier).toBe('FULL_REFUND');
      expect(result.refundPercent).toBe(100);
      expect(result.refundAmount).toBe(200.0);
      expect(result.isEligibleForRefund).toBe(true);
      expect(result.refundCompleted).toBe(false);
      expect(result.refundExecutionStatus).toBe('PENDING_HOST_PROCESSING');
      // Crucial Safety: In Zero-Migration mode, targetPaymentStatus remains PAID in DB until gateway execution
      expect(result.targetPaymentStatus).toBe(PaymentStatus.PAID);
      expect(result.targetPaymentStatus).not.toBe(PaymentStatus.REFUNDED);
    });

    it('should calculate 100% refund eligibility at exact 120 hours boundary and preserve CAPTURED', () => {
      const checkIn = new Date('2026-11-15T12:00:00Z'); // exactly 120 hours ahead
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.CAPTURED, NOW);

      expect(result.policyTier).toBe('FULL_REFUND');
      expect(result.refundPercent).toBe(100);
      expect(result.targetPaymentStatus).toBe(PaymentStatus.CAPTURED);
      expect(result.refundCompleted).toBe(false);
    });
  });

  describe('2. Partial Refund Tier (1-5 days / 24 to <120 hours before check-in)', () => {
    it('should calculate 50% refund eligibility 3 days before check-in without prematurely marking PARTIAL_REFUND', () => {
      const checkIn = new Date('2026-11-13T12:00:00Z'); // 72 hours ahead
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.PAID, NOW);

      expect(result.policyTier).toBe('PARTIAL_REFUND');
      expect(result.refundPercent).toBe(50);
      expect(result.refundAmount).toBe(100.0);
      expect(result.isEligibleForRefund).toBe(true);
      expect(result.refundCompleted).toBe(false);
      expect(result.refundExecutionStatus).toBe('PENDING_HOST_PROCESSING');
      // Crucial Safety: Preserves PAID in DB until actual gateway confirmation
      expect(result.targetPaymentStatus).toBe(PaymentStatus.PAID);
      expect(result.targetPaymentStatus).not.toBe(PaymentStatus.PARTIAL_REFUND);
    });

    it('should calculate 50% refund at exact 24 hours boundary and preserve CAPTURED', () => {
      const checkIn = new Date('2026-11-11T12:00:00Z'); // exactly 24 hours ahead
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.CAPTURED, NOW);

      expect(result.policyTier).toBe('PARTIAL_REFUND');
      expect(result.refundPercent).toBe(50);
      expect(result.refundAmount).toBe(100.0);
      expect(result.targetPaymentStatus).toBe(PaymentStatus.CAPTURED);
      expect(result.refundCompleted).toBe(false);
    });
  });

  describe('3. Non-Refundable Tier (< 24 hours before check-in or past check-in)', () => {
    it('should grant 0% refund and retain CAPTURED when cancelled 12 hours before check-in', () => {
      const checkIn = new Date('2026-11-11T00:00:00Z'); // 12 hours ahead
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.CAPTURED, NOW);

      expect(result.policyTier).toBe('NON_REFUNDABLE');
      expect(result.refundPercent).toBe(0);
      expect(result.refundAmount).toBe(0);
      expect(result.isEligibleForRefund).toBe(false);
      expect(result.refundCompleted).toBe(false);
      expect(result.refundExecutionStatus).toBe('NOT_APPLICABLE_NON_REFUNDABLE');
      expect(result.targetPaymentStatus).toBe(PaymentStatus.CAPTURED);
    });

    it('should grant 0% refund when check-in date has already passed', () => {
      const checkIn = new Date('2026-11-09T12:00:00Z'); // in the past
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.PAID, NOW);

      expect(result.policyTier).toBe('NON_REFUNDABLE');
      expect(result.refundPercent).toBe(0);
      expect(result.refundAmount).toBe(0);
      expect(result.isEligibleForRefund).toBe(false);
      expect(result.targetPaymentStatus).toBe(PaymentStatus.PAID);
    });
  });

  describe('4. Payment Safety: Unpaid Bookings (Never refund uncollected payments)', () => {
    it('should retain UNPAID status and mark refund NOT_APPLICABLE when cancelling an UNPAID booking 10 days ahead', () => {
      const checkIn = new Date('2026-11-20T12:00:00Z'); // 10 days ahead
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.UNPAID, NOW);

      expect(result.policyTier).toBe('FULL_REFUND');
      expect(result.refundPercent).toBe(100);
      expect(result.refundAmount).toBe(200.0);
      // Because the guest never paid (e.g. Pay at Property), targetPaymentStatus remains strictly UNPAID
      expect(result.targetPaymentStatus).toBe(PaymentStatus.UNPAID);
      expect(result.refundCompleted).toBe(false);
      expect(result.refundExecutionStatus).toBe('NOT_APPLICABLE_NO_PAYMENT');
    });

    it('should retain UNPAID status when cancelling an UNPAID booking 3 days ahead', () => {
      const checkIn = new Date('2026-11-13T12:00:00Z'); // 3 days ahead
      const result = calculateCancellationRefund(checkIn, BASE_PRICE, PaymentStatus.UNPAID, NOW);

      expect(result.policyTier).toBe('PARTIAL_REFUND');
      expect(result.targetPaymentStatus).toBe(PaymentStatus.UNPAID);
      expect(result.refundCompleted).toBe(false);
      expect(result.refundExecutionStatus).toBe('NOT_APPLICABLE_NO_PAYMENT');
    });
  });
});
