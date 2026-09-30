const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  const biz = await prisma.business.findMany();
  const listings = await prisma.listing.findMany();
  const bookings = await prisma.booking.findMany();

  console.log('--- USERS ---', users);
  console.log('--- BUSINESSES ---', biz);
  console.log('--- LISTINGS ---', listings);
  console.log('--- BOOKINGS ---', bookings);
}

main().finally(() => prisma.$disconnect());
