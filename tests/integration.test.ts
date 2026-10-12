import request from 'supertest';
import { app } from '../src/index';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Booking Platform Integration Test Suite', () => {
  let authToken = '';
  let testUserId = '';
  let testListingId = '';
  let testBusinessId = '';

  beforeAll(async () => {
    // Ensure test user exists or login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nimuu1449disanayaka@gmail.com',
        password: 'password123',
      });

    if (loginRes.status === 200 && loginRes.body.token) {
      authToken = loginRes.body.token;
      testUserId = loginRes.body.user.id;
    } else {
      // Create if needed
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test Integration User',
          email: `test_${Date.now()}@ceylonstays.com`,
          password: 'password123',
          phone: '+94770000000',
          role: 'OWNER',
        });
      authToken = regRes.body.token;
      testUserId = regRes.body.user.id;
    }

    // Get any active listing from DB for availability tests
    const listing = await prisma.listing.findFirst({
      where: { isActive: true },
      include: { business: true },
    });

    if (listing) {
      testListingId = listing.id;
      testBusinessId = listing.businessId;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Health Check Endpoint', () => {
    it('should return 200 OK and health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
      expect(res.body.message).toContain('Booking Platform Backend API is running smoothly');
    });
  });

  describe('2. Authentication Flow', () => {
    it('should fail login with invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nimuu1449disanayaka@gmail.com',
          password: 'wrongpassword999',
        });
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('should return 200 and a JWT token on valid login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nimuu1449disanayaka@gmail.com',
          password: 'password123',
        });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('nimuu1449disanayaka@gmail.com');
    });
  });

  describe('3. Payment Gateway API (Stripe / Simulation)', () => {
    it('should create a payment intent and return clientSecret', async () => {
      const res = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 150.0,
          currency: 'usd',
          listingId: testListingId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.clientSecret).toBeDefined();
      expect(res.body.amount).toBe(150.0);
    });

    it('should reject payment intent with invalid amount', async () => {
      const res = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: -50,
          currency: 'usd',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('4. Listing Availability & Host Blocked Dates', () => {
    it('should return availability for a valid date range', async () => {
      if (!testListingId) return;

      const checkIn = '2027-01-10';
      const checkOut = '2027-01-15';

      const res = await request(app)
        .get(`/api/listings/${testListingId}/availability`)
        .query({ checkIn, checkOut });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('available');
      expect(Array.isArray(res.body.unavailableRanges)).toBe(true);
    });

    it('should allow host to create a blocked date range and reflect in availability', async () => {
      if (!testListingId) return;

      const blockStart = '2027-02-01T00:00:00.000Z';
      const blockEnd = '2027-02-05T00:00:00.000Z';

      // Create blocked date
      const createRes = await request(app)
        .post(`/api/listings/${testListingId}/blocked-dates`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          startDate: blockStart,
          endDate: blockEnd,
          reason: 'Maintenance Testing in Integration Suite',
        });

      expect([200, 201]).toContain(createRes.status);
      const blockedId = createRes.body.id;

      // Verify availability is false for this range
      const availRes = await request(app)
        .get(`/api/listings/${testListingId}/availability`)
        .query({ checkIn: '2027-02-02', checkOut: '2027-02-04' });

      expect(availRes.status).toBe(200);
      expect(availRes.body.available).toBe(false);

      // Clean up blocked date
      if (blockedId) {
        const delRes = await request(app)
          .delete(`/api/listings/${testListingId}/blocked-dates/${blockedId}`)
          .set('Authorization', `Bearer ${authToken}`);
        expect(delRes.status).toBe(200);
      }
    });
  });

  describe('5. Double Booking Prevention (Conflict Handling)', () => {
    it('should reject booking if dates conflict with an existing booking', async () => {
      if (!testListingId) return;

      // Create a confirmed booking directly in DB for testing
      const testCheckIn = new Date('2027-03-10T12:00:00Z');
      const testCheckOut = new Date('2027-03-15T12:00:00Z');

      const existingBooking = await prisma.booking.create({
        data: {
          foreignerId: testUserId,
          listingId: testListingId,
          checkIn: testCheckIn,
          checkOut: testCheckOut,
          totalPrice: 400.0,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
        },
      });

      // Attempt to book overlapping dates
      const conflictRes = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          listingId: testListingId,
          checkIn: '2027-03-12T12:00:00Z',
          checkOut: '2027-03-14T12:00:00Z',
          totalPrice: 160.0,
        });

      // Expect conflict
      expect([400, 409]).toContain(conflictRes.status);

      // Clean up test booking
      await prisma.booking.delete({ where: { id: existingBooking.id } });
    });
  });
});
