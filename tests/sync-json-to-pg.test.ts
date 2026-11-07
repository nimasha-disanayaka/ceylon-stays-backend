import {
  evaluateMigrationPlan,
  checkExecutionFlags,
  computeFileSha256,
  StoreData,
} from '../scripts/sync-json-to-pg';
import * as path from 'path';

describe('JSON to PostgreSQL Migration Safety & Reconciliation Tests', () => {
  const sampleStore: StoreData = {
    users: [
      {
        id: 'user-owner-default',
        email: 'nimuu1449disanayaka@gmail.com',
        passwordHash: '$2a$10$w09Z4z1pC0h5kR1wDq9mVuYhR3v3eSg.p4c2mI1F0Q1p2s3t4u5v.',
        name: 'Nimasha Disanayaka',
        role: 'OWNER',
      },
      {
        id: 'user-owner-1',
        email: 'owner@gmail.com',
        passwordHash: '$2a$10$w09Z4z1pC0h5kR1wDq9mVuYhR3v3eSg.p4c2mI1F0Q1p2s3t4u5v.',
        name: 'Demo Owner',
        role: 'OWNER',
      },
    ],
    businesses: [
      {
        id: 'biz-gurupokuna',
        ownerId: 'pg-user-uuid-nimasha', // Direct ID match
        name: 'gurupokuna beach hotel',
        type: 'HOTEL',
        address: 'gurupokuna hungama',
        latitude: 5.9483,
        longitude: 80.4716,
        imageUrls: ['https://example.com/beach.jpg'],
      },
      {
        id: 'biz-mirissa',
        ownerId: 'user-owner-1', // Matches owner@gmail.com via email mapping
        name: 'Mirissa Luxury Hotel',
        type: 'HOTEL',
        address: 'Beach Road, Mirissa',
        latitude: 5.9483,
        longitude: 80.4716,
        imageUrls: ['https://example.com/mirissa.jpg'],
      },
      {
        id: 'biz-unverified',
        ownerId: 'non-existent-user-id', // Neither in PG nor in JSON
        name: 'Ghost Hotel',
        type: 'HOTEL',
        address: 'Unknown',
        latitude: 0,
        longitude: 0,
        imageUrls: [],
      },
    ],
    listings: [
      {
        id: 'list-gurupokuna-room',
        businessId: 'biz-gurupokuna',
        name: 'Ad Sea View',
        pricePerNight: 85,
        maxGuests: 2,
        amenities: ['WiFi', 'AC'],
        isActive: true,
      },
      {
        id: 'list-mirissa-room',
        businessId: 'biz-mirissa',
        name: 'Deluxe Room',
        pricePerNight: 100,
        maxGuests: 2,
        amenities: ['WiFi', 'Pool'],
        isActive: true,
      },
      {
        id: 'list-orphaned-room',
        businessId: 'biz-unverified',
        name: 'Orphaned Suite',
        pricePerNight: 120,
        maxGuests: 2,
        amenities: ['AC'],
        isActive: true,
      },
    ],
    bookings: [
      {
        id: 'booking-demo-1',
        foreignerId: 'af4a3103-24d1-4e2a-8721-58d93a044528',
        listingId: 'list-gurupokuna-room',
        checkIn: '2026-12-07T14:00:00.000Z',
        checkOut: '2026-12-31T11:00:00.000Z',
        totalPrice: 2040,
        status: 'CONFIRMED',
        paymentStatus: 'CAPTURED',
      },
      {
        id: 'booking-demo-2',
        foreignerId: 'ba7dc026-361d-4460-be04-1b5aa22697b0',
        listingId: 'non-existent-listing',
        checkIn: '2026-11-20T14:00:00.000Z',
        checkOut: '2026-11-23T11:00:00.000Z',
        totalPrice: 255,
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
      },
    ],
  };

  const mockPgContext = {
    users: [
      { id: 'pg-user-uuid-nimasha', email: 'nimuu1449disanayaka@gmail.com' },
      { id: 'pg-user-uuid-demo-owner', email: 'owner@gmail.com' },
    ],
    businesses: [
      { id: 'biz-existing-in-pg', name: 'Existing Hotel' },
    ],
    listings: [
      { id: 'list-existing-in-pg', name: 'Existing Room' },
    ],
  };

  describe('1. Execution Guardrail Tests', () => {
    it('should block execution when only --execute is passed without --confirm-production', () => {
      const flags = checkExecutionFlags(['--execute']);
      expect(flags.isExecutionRequested).toBe(true);
      expect(flags.isConfirmed).toBe(false);
      expect(flags.canExecute).toBe(false);
    });

    it('should block execution when only --confirm-production is passed without --execute', () => {
      const flags = checkExecutionFlags(['--confirm-production']);
      expect(flags.isExecutionRequested).toBe(false);
      expect(flags.isConfirmed).toBe(true);
      expect(flags.canExecute).toBe(false);
    });

    it('should permit execution ONLY when BOTH --execute and --confirm-production are passed', () => {
      const flags = checkExecutionFlags(['--execute', '--confirm-production']);
      expect(flags.canExecute).toBe(true);
    });

    it('should default to safe dry-run when no arguments are provided', () => {
      const flags = checkExecutionFlags([]);
      expect(flags.canExecute).toBe(false);
    });
  });

  describe('2. Historical Demo Bookings Quarantine Policy', () => {
    it('should quarantine 100% of demo bookings and never mark them eligible', () => {
      const plan = evaluateMigrationPlan(sampleStore, mockPgContext, 'test-hash');

      expect(plan.quarantinedBookings).toHaveLength(2);
      expect(plan.quarantinedBookings[0].booking.id).toBe('booking-demo-1');
      expect(plan.quarantinedBookings[0].reason).toContain('Historical demo booking excluded from production migration');
      expect(plan.quarantinedBookings[1].booking.id).toBe('booking-demo-2');
    });

    it('should flag defective foreign keys on quarantined bookings', () => {
      const plan = evaluateMigrationPlan(sampleStore, mockPgContext, 'test-hash');

      const booking2 = plan.quarantinedBookings.find((b) => b.booking.id === 'booking-demo-2');
      expect(booking2).toBeDefined();
      expect(booking2!.missingReferences.length).toBeGreaterThan(0);
      expect(booking2!.missingReferences.some((r) => r.includes('non-existent-listing'))).toBe(true);
    });
  });

  describe('3. Business Verification and Owner Reconciliation', () => {
    it('should verify business with direct PostgreSQL user ID match', () => {
      const plan = evaluateMigrationPlan(sampleStore, mockPgContext, 'test-hash');

      const bizGurupokuna = plan.eligibleBusinesses.find((b) => b.business.id === 'biz-gurupokuna');
      expect(bizGurupokuna).toBeDefined();
      expect(bizGurupokuna!.resolutionMethod).toBe('DIRECT_ID_MATCH');
      expect(bizGurupokuna!.resolvedOwnerId).toBe('pg-user-uuid-nimasha');
      expect(bizGurupokuna!.ownerEmail).toBe('nimuu1449disanayaka@gmail.com');
    });

    it('should verify business by mapping JSON owner email to PostgreSQL user account', () => {
      const plan = evaluateMigrationPlan(sampleStore, mockPgContext, 'test-hash');

      const bizMirissa = plan.eligibleBusinesses.find((b) => b.business.id === 'biz-mirissa');
      expect(bizMirissa).toBeDefined();
      expect(bizMirissa!.resolutionMethod).toBe('EMAIL_MAPPED_MATCH');
      expect(bizMirissa!.resolvedOwnerId).toBe('pg-user-uuid-demo-owner');
      expect(bizMirissa!.ownerEmail).toBe('owner@gmail.com');
    });

    it('should quarantine business if owner cannot be verified in PostgreSQL', () => {
      const plan = evaluateMigrationPlan(sampleStore, mockPgContext, 'test-hash');

      const bizGhost = plan.quarantinedBusinesses.find((b) => b.business.id === 'biz-unverified');
      expect(bizGhost).toBeDefined();
      expect(bizGhost!.reason).toContain('Owner cannot be verified');
      expect(bizGhost!.attemptedOwnerId).toBe('non-existent-user-id');
    });
  });

  describe('4. Listing Verification and Cascading Isolation', () => {
    it('should verify listings whose parent businesses are eligible for migration', () => {
      const plan = evaluateMigrationPlan(sampleStore, mockPgContext, 'test-hash');

      const listGurupokuna = plan.eligibleListings.find((l) => l.listing.id === 'list-gurupokuna-room');
      expect(listGurupokuna).toBeDefined();
      expect(listGurupokuna!.businessName).toBe('gurupokuna beach hotel');

      const listMirissa = plan.eligibleListings.find((l) => l.listing.id === 'list-mirissa-room');
      expect(listMirissa).toBeDefined();
      expect(listMirissa!.businessName).toBe('Mirissa Luxury Hotel');
    });

    it('should quarantine listing when its parent business is quarantined', () => {
      const plan = evaluateMigrationPlan(sampleStore, mockPgContext, 'test-hash');

      const orphanedList = plan.quarantinedListings.find((l) => l.listing.id === 'list-orphaned-room');
      expect(orphanedList).toBeDefined();
      expect(orphanedList!.reason).toContain("Parent business 'biz-unverified' is unverified or quarantined");
    });
  });

  describe('5. Integrity & Checksum Verification', () => {
    it('should calculate SHA-256 hash for existing JSON file', () => {
      const jsonPath = path.resolve(__dirname, '../data/db-store.json');
      const hash = computeFileSha256(jsonPath);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 produces 64 hex characters
    });
  });
});

