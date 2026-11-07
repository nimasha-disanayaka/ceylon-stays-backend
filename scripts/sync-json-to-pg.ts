import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

// Data interfaces matching db-store.json structure
export interface StoreUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone?: string;
  role: 'OWNER' | 'FOREIGNER';
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreBusiness {
  id: string;
  ownerId: string;
  name: string;
  type: 'HOTEL' | 'HOMESTAY' | 'RESTAURANT';
  description?: string;
  address: string;
  latitude: number;
  longitude: number;
  imageUrls: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreListing {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  pricePerNight: number;
  maxGuests: number;
  amenities: string[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreBooking {
  id: string;
  foreignerId: string;
  listingId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'DECLINED' | 'NO_SHOW';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'AUTHORIZED' | 'CAPTURED' | 'RELEASED' | 'PARTIAL_REFUND';
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreData {
  users: StoreUser[];
  businesses: StoreBusiness[];
  listings: StoreListing[];
  bookings: StoreBooking[];
  reviews?: any[];
  blockedDates?: any[];
}

export interface VerifiedBusiness {
  business: StoreBusiness;
  resolvedOwnerId: string;
  ownerEmail?: string;
  resolutionMethod: 'DIRECT_ID_MATCH' | 'EMAIL_MAPPED_MATCH';
  alreadyExistsInPg: boolean;
}

export interface QuarantinedBusiness {
  business: StoreBusiness;
  reason: string;
  attemptedOwnerId: string;
}

export interface VerifiedListing {
  listing: StoreListing;
  businessName: string;
  alreadyExistsInPg: boolean;
}

export interface QuarantinedListing {
  listing: StoreListing;
  reason: string;
  attemptedBusinessId: string;
}

export interface QuarantinedBooking {
  booking: StoreBooking;
  reason: string;
  missingReferences: string[];
}

export interface MigrationPlan {
  sha256: string;
  timestamp: string;
  eligibleBusinesses: VerifiedBusiness[];
  quarantinedBusinesses: QuarantinedBusiness[];
  eligibleListings: VerifiedListing[];
  quarantinedListings: QuarantinedListing[];
  quarantinedBookings: QuarantinedBooking[];
}

/**
 * Computes SHA-256 hash of a file for integrity verification against AWS server copy.
 */
export function computeFileSha256(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Evaluates migration eligibility and quarantine routing without side effects.
 */
export function evaluateMigrationPlan(
  store: StoreData,
  pgContext: {
    users: Array<{ id: string; email: string }>;
    businesses: Array<{ id: string; name: string }>;
    listings: Array<{ id: string; name: string }>;
  },
  fileHash: string = ''
): MigrationPlan {
  const plan: MigrationPlan = {
    sha256: fileHash,
    timestamp: new Date().toISOString(),
    eligibleBusinesses: [],
    quarantinedBusinesses: [],
    eligibleListings: [],
    quarantinedListings: [],
    quarantinedBookings: [],
  };

  // 1. Process Bookings: Per user decision, 100% of historical demo bookings are quarantined
  for (const b of store.bookings) {
    const missing: string[] = [];
    const userInPg = pgContext.users.find((u) => u.id === b.foreignerId);
    const userInJson = store.users.find((u) => u.id === b.foreignerId);
    if (!userInPg && !userInJson) {
      missing.push(`User ID '${b.foreignerId}' not found in PostgreSQL or JSON users`);
    }

    const listingInPg = pgContext.listings.find((l) => l.id === b.listingId);
    const listingInJson = store.listings.find((l) => l.id === b.listingId);
    if (!listingInPg && !listingInJson) {
      missing.push(`Listing ID '${b.listingId}' not found in PostgreSQL or JSON listings`);
    }

    let reason = 'Historical demo booking excluded from production migration. Preserved in quarantine ledger.';
    if (missing.length > 0) {
      reason += ` Foreign key defects: ${missing.join('; ')}.`;
    }

    plan.quarantinedBookings.push({
      booking: { ...b },
      reason,
      missingReferences: missing,
    });
  }

  // 2. Process Businesses: Verify ownership against PostgreSQL users
  const pgUserById = new Map(pgContext.users.map((u) => [u.id, u]));
  const pgUserByEmail = new Map(pgContext.users.map((u) => [u.email.toLowerCase(), u]));
  const pgBusinessById = new Map(pgContext.businesses.map((b) => [b.id, b]));

  for (const b of store.businesses) {
    const alreadyExists = pgBusinessById.has(b.id);

    // Method A: Direct ID Match in PostgreSQL
    const directOwner = pgUserById.get(b.ownerId);
    if (directOwner) {
      plan.eligibleBusinesses.push({
        business: { ...b },
        resolvedOwnerId: directOwner.id,
        ownerEmail: directOwner.email,
        resolutionMethod: 'DIRECT_ID_MATCH',
        alreadyExistsInPg: alreadyExists,
      });
      continue;
    }

    // Method B: Match via JSON user email to existing PostgreSQL user
    const jsonUser = store.users.find((u) => u.id === b.ownerId);
    if (jsonUser) {
      const mappedOwner = pgUserByEmail.get(jsonUser.email.toLowerCase());
      if (mappedOwner) {
        plan.eligibleBusinesses.push({
          business: { ...b },
          resolvedOwnerId: mappedOwner.id,
          ownerEmail: mappedOwner.email,
          resolutionMethod: 'EMAIL_MAPPED_MATCH',
          alreadyExistsInPg: alreadyExists,
        });
        continue;
      }
    }

    // If owner cannot be verified, quarantine the business record
    const ownerEmailDesc = jsonUser ? ` (email: ${jsonUser.email})` : ' (no JSON user record)';
    plan.quarantinedBusinesses.push({
      business: { ...b },
      reason: `Owner cannot be verified: ownerId '${b.ownerId}'${ownerEmailDesc} does not exist in PostgreSQL.`,
      attemptedOwnerId: b.ownerId,
    });
  }

  // 3. Process Listings: Verify parent business exists or is eligible
  const pgListingById = new Map(pgContext.listings.map((l) => [l.id, l]));
  const eligibleBusinessMap = new Map(plan.eligibleBusinesses.map((eb) => [eb.business.id, eb.business.name]));

  for (const l of store.listings) {
    const alreadyExists = pgListingById.has(l.id);

    if (pgBusinessById.has(l.businessId)) {
      const parentName = pgBusinessById.get(l.businessId)!.name;
      plan.eligibleListings.push({
        listing: { ...l },
        businessName: parentName,
        alreadyExistsInPg: alreadyExists,
      });
      continue;
    }

    if (eligibleBusinessMap.has(l.businessId)) {
      const parentName = eligibleBusinessMap.get(l.businessId)!;
      plan.eligibleListings.push({
        listing: { ...l },
        businessName: parentName,
        alreadyExistsInPg: alreadyExists,
      });
      continue;
    }

    // Parent business is missing or quarantined
    plan.quarantinedListings.push({
      listing: { ...l },
      reason: `Parent business '${l.businessId}' is unverified or quarantined in PostgreSQL.`,
      attemptedBusinessId: l.businessId,
    });
  }

  return plan;
}

/**
 * Validates execution safety flags. Requires BOTH --execute AND --confirm-production.
 */
export function checkExecutionFlags(args: string[]): { isExecutionRequested: boolean; isConfirmed: boolean; canExecute: boolean } {
  const isExecutionRequested = args.includes('--execute');
  const isConfirmed = args.includes('--confirm-production');
  return {
    isExecutionRequested,
    isConfirmed,
    canExecute: isExecutionRequested && isConfirmed,
  };
}

/**
 * Main reconciliation execution routine.
 */
export async function runReconciliation(customJsonPath?: string) {
  console.log('========================================================================');
  console.log(' CEYLON STAYS: SELECTIVE JSON-TO-POSTGRESQL RECONCILIATION');
  console.log(' Scope: Verified Businesses & Listings Only (Bookings Quarantined)');
  console.log('========================================================================\n');

  const args = process.argv.slice(2);
  const flags = checkExecutionFlags(args);

  if (flags.isExecutionRequested && !flags.isConfirmed) {
    console.warn('************************************************************************');
    console.warn(' [SECURITY GUARD TRIGGERED]');
    console.warn(' Execution aborted: Live migration requires BOTH:');
    console.warn('   --execute');
    console.warn('   --confirm-production');
    console.warn(' Defaulting to SAFE READ-ONLY DRY-RUN. Zero database writes will occur.');
    console.warn('************************************************************************\n');
  }

  const isDryRun = !flags.canExecute;
  console.log(`Execution Mode: ${isDryRun ? 'READ-ONLY DRY-RUN (Safe: no data altered)' : 'LIVE PRODUCTION EXECUTION'}`);

  // Resolve JSON source file
  const jsonFilePath = customJsonPath || path.resolve(__dirname, '../data/db-store.json');
  if (!fs.existsSync(jsonFilePath)) {
    console.error(`Error: Source JSON file not found at ${jsonFilePath}`);
    return;
  }

  const sha256 = computeFileSha256(jsonFilePath);
  console.log(`Source File: ${jsonFilePath}`);
  console.log(`SHA-256:     ${sha256}`);
  console.log('Note: Verify this SHA-256 against your server before running production migration.\n');

  // Automatic immutable pre-migration backup
  const backupDir = path.resolve(__dirname, '../data');
  const backupFilePath = path.join(backupDir, 'db-store.backup-pre-migration.json');
  if (!fs.existsSync(backupFilePath)) {
    fs.copyFileSync(jsonFilePath, backupFilePath);
    console.log(`✓ Created immutable pre-migration backup at: ${backupFilePath}\n`);
  }

  const rawJson = fs.readFileSync(jsonFilePath, 'utf8');
  const store: StoreData = JSON.parse(rawJson);

  // Check PostgreSQL Database Connection
  let isDbConnected = false;
  let pgUsers: Array<{ id: string; email: string }> = [];
  let pgBusinesses: Array<{ id: string; name: string }> = [];
  let pgListings: Array<{ id: string; name: string }> = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    isDbConnected = true;
    console.log('✓ Successfully connected to PostgreSQL database.\n');

    pgUsers = await prisma.user.findMany({ select: { id: true, email: true } });
    pgBusinesses = await prisma.business.findMany({ select: { id: true, name: true } });
    pgListings = await prisma.listing.findMany({ select: { id: true, name: true } });

    console.log(`PostgreSQL Inventory:`);
    console.log(`  Users:      ${pgUsers.length}`);
    console.log(`  Businesses: ${pgBusinesses.length}`);
    console.log(`  Listings:   ${pgListings.length}`);
    console.log('');
  } catch (err: any) {
    console.warn('! Notice: Could not connect to PostgreSQL database:', err.message);
    console.warn('  (Evaluating against JSON store structure. To evaluate live DB state, ensure PostgreSQL is running.)\n');
  }

  // Evaluate Plan
  const plan = evaluateMigrationPlan(store, { users: pgUsers, businesses: pgBusinesses, listings: pgListings }, sha256);

  // Persist Quarantine Ledger
  const quarantineFilePath = path.resolve(__dirname, '../data/migration-quarantine.json');
  const quarantinePayload = {
    generatedAt: plan.timestamp,
    sourceJsonFile: jsonFilePath,
    sourceJsonSha256: plan.sha256,
    policy: {
      bookingPolicy: '100% of historical demo bookings quarantined. Never imported to production.',
      businessPolicy: 'Only businesses with verified PostgreSQL owners are eligible. Unverified owners quarantined.',
      listingPolicy: 'Only listings with verified parent businesses are eligible. Orphaned listings quarantined.',
    },
    summary: {
      totalBookingsQuarantined: plan.quarantinedBookings.length,
      totalBusinessesQuarantined: plan.quarantinedBusinesses.length,
      totalListingsQuarantined: plan.quarantinedListings.length,
      totalEligibleBusinesses: plan.eligibleBusinesses.length,
      totalEligibleListings: plan.eligibleListings.length,
    },
    quarantinedBookings: plan.quarantinedBookings,
    quarantinedBusinesses: plan.quarantinedBusinesses,
    quarantinedListings: plan.quarantinedListings,
  };

  fs.writeFileSync(quarantineFilePath, JSON.stringify(quarantinePayload, null, 2), 'utf8');
  console.log(`✓ Quarantine ledger written to: ${quarantineFilePath}\n`);

  // Print Summary
  console.log('========================================================================');
  console.log(' RECONCILIATION SUMMARY & ELIGIBILITY REPORT');
  console.log('========================================================================');

  console.log('\n--- 1. HOTELS / BUSINESSES ---');
  console.log(`Total in JSON:       ${store.businesses.length}`);
  console.log(`Eligible to Migrate: ${plan.eligibleBusinesses.length}`);
  console.log(`Blocked/Quarantined: ${plan.quarantinedBusinesses.length}`);
  for (const eb of plan.eligibleBusinesses) {
    const status = eb.alreadyExistsInPg ? '[ALREADY IN PG]' : '[READY TO MIGRATE]';
    console.log(`  + ${status} "${eb.business.name}" (${eb.business.id})`);
    console.log(`      Resolved Owner: ${eb.resolvedOwnerId} (${eb.ownerEmail}) [${eb.resolutionMethod}]`);
  }
  for (const qb of plan.quarantinedBusinesses) {
    console.log(`  - [QUARANTINED] "${qb.business.name}" (${qb.business.id})`);
    console.log(`      Reason: ${qb.reason}`);
  }

  console.log('\n--- 2. ROOMS / LISTINGS ---');
  console.log(`Total in JSON:       ${store.listings.length}`);
  console.log(`Eligible to Migrate: ${plan.eligibleListings.length}`);
  console.log(`Blocked/Quarantined: ${plan.quarantinedListings.length}`);
  for (const el of plan.eligibleListings) {
    const status = el.alreadyExistsInPg ? '[ALREADY IN PG]' : '[READY TO MIGRATE]';
    console.log(`  + ${status} "${el.listing.name}" ($${el.listing.pricePerNight}) -> Business: "${el.businessName}"`);
  }
  for (const ql of plan.quarantinedListings) {
    console.log(`  - [QUARANTINED] "${ql.listing.name}" (${ql.listing.id})`);
    console.log(`      Reason: ${ql.reason}`);
  }

  console.log('\n--- 3. HISTORICAL DEMO BOOKINGS ---');
  console.log(`Total in JSON:       ${store.bookings.length}`);
  console.log(`Eligible to Migrate: 0 (Policy: 100% quarantined)`);
  console.log(`Quarantined Backups: ${plan.quarantinedBookings.length}`);
  for (const qb of plan.quarantinedBookings) {
    console.log(`  - [QUARANTINED] Booking ${qb.booking.id} ($${qb.booking.totalPrice}) - Status: ${qb.booking.status}`);
    console.log(`      Reason: ${qb.reason}`);
  }

  // Execution Phase (Strictly guarded)
  if (!isDryRun) {
    if (!isDbConnected) {
      console.error('\nCRITICAL: Cannot execute migration without an active PostgreSQL database connection.');
      return;
    }

    console.log('\n========================================================================');
    console.log(' EXECUTING ATOMIC DATABASE TRANSACTION (LIVE)');
    console.log('========================================================================');

    await prisma.$transaction(async (tx) => {
      // 1. Insert verified businesses
      for (const item of plan.eligibleBusinesses) {
        if (item.alreadyExistsInPg) {
          console.log(`  - [SKIP] Business "${item.business.name}" already exists.`);
          continue;
        }
        await tx.business.create({
          data: {
            id: item.business.id,
            ownerId: item.resolvedOwnerId,
            name: item.business.name,
            type: item.business.type,
            description: item.business.description || null,
            address: item.business.address,
            latitude: item.business.latitude,
            longitude: item.business.longitude,
            imageUrls: item.business.imageUrls,
          },
        });
        console.log(`  ✓ Inserted business: "${item.business.name}" (${item.business.id})`);
      }

      // 2. Insert verified listings
      for (const item of plan.eligibleListings) {
        if (item.alreadyExistsInPg) {
          console.log(`  - [SKIP] Listing "${item.listing.name}" already exists.`);
          continue;
        }
        await tx.listing.create({
          data: {
            id: item.listing.id,
            businessId: item.listing.businessId,
            name: item.listing.name,
            description: item.listing.description || null,
            pricePerNight: item.listing.pricePerNight,
            maxGuests: item.listing.maxGuests,
            amenities: item.listing.amenities,
            isActive: item.listing.isActive,
          },
        });
        console.log(`  ✓ Inserted listing: "${item.listing.name}" (${item.listing.id})`);
      }
    });

    console.log('\n✓ Atomic migration completed successfully. All eligible records committed to PostgreSQL.');
  } else {
    console.log('\n========================================================================');
    console.log(' DRY-RUN COMPLETE: 0 database modifications made.');
    console.log(' PostgreSQL records remain completely untouched.');
    console.log(' All quarantined records safely preserved in data/migration-quarantine.json');
    console.log('========================================================================\n');
  }
}

// CLI entry point
if (require.main === module) {
  runReconciliation()
    .catch((err) => {
      console.error('Reconciliation error:', err);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
