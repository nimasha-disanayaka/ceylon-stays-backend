import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding PostgreSQL database at localhost:5433...');
  
  const hash = await bcrypt.hash('@11Ad4nimuu', 10);
  const owner = await prisma.user.upsert({
    where: { email: 'nimuu1449disanayaka@gmail.com' },
    update: { passwordHash: hash },
    create: {
      id: 'user-owner-1',
      email: 'nimuu1449disanayaka@gmail.com',
      name: 'nimu',
      passwordHash: hash,
      role: 'OWNER',
    },
  });
  console.log('✅ Owner user seeded:', owner.email);

  const biz1 = await prisma.business.upsert({
    where: { id: 'biz-demo-1' },
    update: {},
    create: {
      id: 'biz-demo-1',
      ownerId: owner.id,
      name: 'Mirissa Ocean Homestay',
      type: 'HOMESTAY',
      description: 'Beachfront luxury homestay in Mirissa with ocean view rooms.',
      address: 'Beach Road, Mirissa, Southern Province',
      latitude: 5.9483,
      longitude: 80.4716,
    },
  });
  console.log('✅ Business 1 seeded:', biz1.name);

  const listing1 = await prisma.listing.upsert({
    where: { id: 'listing-demo-1' },
    update: {},
    create: {
      id: 'listing-demo-1',
      businessId: biz1.id,
      name: 'Mirissa Ocean View Deluxe Room',
      description: 'Spacious deluxe room with private balcony overlooking the ocean',
      pricePerNight: 120,
      maxGuests: 4,
      isActive: true,
    },
  });
  console.log('✅ Listing 1 seeded:', listing1.name);

  const biz2 = await prisma.business.upsert({
    where: { id: 'biz-demo-2' },
    update: {},
    create: {
      id: 'biz-demo-2',
      ownerId: owner.id,
      name: 'Cinnamon Citadel Kandy',
      type: 'HOTEL',
      description: 'Scenic riverfront hotel nestled in the hills of Kandy.',
      address: 'Srimath Kudaratwatta Mawatha, Kandy, Central Province',
      latitude: 7.2906,
      longitude: 80.6337,
    },
  });
  console.log('✅ Business 2 seeded:', biz2.name);

  const listing2 = await prisma.listing.upsert({
    where: { id: 'listing-demo-2' },
    update: {},
    create: {
      id: 'listing-demo-2',
      businessId: biz2.id,
      name: 'Kandy River View Suite',
      description: 'Luxury suite overlooking Mahaweli River',
      pricePerNight: 150,
      maxGuests: 3,
      isActive: true,
    },
  });
  console.log('✅ Listing 2 seeded:', listing2.name);

  // Seed Traveler Guest User
  const traveler = await prisma.user.upsert({
    where: { email: 'traveler@gmail.com' },
    update: {},
    create: {
      id: 'user-traveler-1',
      email: 'traveler@gmail.com',
      name: 'John M.',
      passwordHash: hash,
      role: 'FOREIGNER',
    },
  });
  console.log('✅ Traveler user seeded:', traveler.email);

  // Seed Booking for Traveler
  const booking1 = await prisma.booking.upsert({
    where: { id: 'booking-1' },
    update: {},
    create: {
      id: 'booking-1',
      foreignerId: traveler.id,
      listingId: listing1.id,
      checkIn: new Date('2026-10-10T14:00:00.000Z'),
      checkOut: new Date('2026-10-15T11:00:00.000Z'),
      totalPrice: 600,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
    },
  });
  console.log('✅ Booking 1 seeded:', booking1.id);

  // Seed Review for Booking 1
  const review1 = await prisma.review.upsert({
    where: { bookingId: booking1.id },
    update: {
      rating: 5,
      comment: 'Beautiful stay, walking distance to the beach, host was incredibly kind.',
      reply: 'thnks',
    },
    create: {
      id: 'rev-seed-1',
      bookingId: booking1.id,
      authorId: traveler.id,
      rating: 5,
      comment: 'Beautiful stay, walking distance to the beach, host was incredibly kind.',
      reply: 'thnks',
    },
  });
  console.log('✅ Review 1 seeded:', review1.id);

  console.log('🎉 Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed Error:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
