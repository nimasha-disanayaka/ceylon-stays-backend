import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding PostgreSQL database...');

  const passwordHash = await bcrypt.hash('@11Ad4nimuu', 10);

  // 1. Create or update main owner account
  const owner = await prisma.user.upsert({
    where: { email: 'ghhjjjjj@gmail.com' },
    update: { passwordHash },
    create: {
      email: 'ghhjjjjj@gmail.com',
      name: 'nimu',
      passwordHash,
      phone: '+94771234567',
      role: 'OWNER',
    },
  });

  // 2. Create traveler/foreigner guest account
  const traveler = await prisma.user.upsert({
    where: { email: 'traveler@gmail.com' },
    update: { passwordHash },
    create: {
      email: 'traveler@gmail.com',
      name: 'John Traveler',
      passwordHash,
      phone: '+14155552671',
      role: 'FOREIGNER',
    },
  });

  console.log(`👤 Users created/updated: Owner (${owner.email}), Traveler (${traveler.email})`);

  // Clear previous properties & listings to re-seed cleanly
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.blockedDate.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.business.deleteMany();

  // 3. Create properties for owner
  const biz1 = await prisma.business.create({
    data: {
      ownerId: owner.id,
      name: 'Mirissa Luxury Hotel',
      type: 'HOTEL',
      description: 'Luxury beach hotel in Mirissa with ocean view rooms.',
      address: 'Beach Road, Mirissa',
      latitude: 5.9483,
      longitude: 80.4716,
      imageUrls: ['https://images.unsplash.com/photo-1566073771259-6a8506099945'],
    },
  });

  const biz2 = await prisma.business.create({
    data: {
      ownerId: owner.id,
      name: 'Cinnamon Citadel Kandy,',
      type: 'HOTEL',
      description: 'Riverside luxury resort in the hill capital of Kandy.',
      address: 'Kandy, Sri Lanka',
      latitude: 7.2906,
      longitude: 80.6337,
      imageUrls: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b'],
    },
  });

  const biz3 = await prisma.business.create({
    data: {
      ownerId: owner.id,
      name: 'mirisssa ocean hotel',
      type: 'HOTEL',
      description: 'Beachfront hotel with scenic sunset views.',
      address: 'Beach Road, Mirissa',
      latitude: 5.9483,
      longitude: 80.4716,
      imageUrls: [],
    },
  });

  const biz4 = await prisma.business.create({
    data: {
      ownerId: owner.id,
      name: 'hambnathota beach hotel',
      type: 'HOTEL',
      description: 'Beach side hotel with good features.',
      address: 'Hambantota, Sri Lanka',
      latitude: 6.1248,
      longitude: 81.1185,
      imageUrls: [],
    },
  });

  console.log('🏢 Properties created successfully.');

  // 4. Create room listings under properties
  const listing1 = await prisma.listing.create({
    data: {
      businessId: biz1.id,
      name: 'delux',
      description: 'King bed with private balcony and sea view',
      pricePerNight: 85.0,
      maxGuests: 2,
      amenities: ['WiFi', 'AC', 'Sea View'],
      isActive: true,
    },
  });

  const listing2 = await prisma.listing.create({
    data: {
      businessId: biz2.id,
      name: 'delux river',
      description: 'Riverside suite with king bed and balcony',
      pricePerNight: 103.0,
      maxGuests: 2,
      amenities: ['WiFi', 'AC', 'Sea View'],
      isActive: true,
    },
  });

  await prisma.listing.create({
    data: {
      businessId: biz2.id,
      name: 'delux river',
      description: 'Standard deluxe river room',
      pricePerNight: 85.0,
      maxGuests: 2,
      amenities: ['WiFi', 'AC', 'Sea View'],
      isActive: true,
    },
  });

  console.log('🛏️ Room listings created successfully.');

  // 5. Create a test booking reservation
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 2);
  const checkOut = new Date();
  checkOut.setDate(checkOut.getDate() + 5);

  const booking = await prisma.booking.create({
    data: {
      foreignerId: traveler.id,
      listingId: listing1.id,
      checkIn,
      checkOut,
      totalPrice: 255.0,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
    },
  });

  console.log(`🎟️ Test booking created for ${traveler.name} under ${biz1.name} (ID: ${booking.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
