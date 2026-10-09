import { Router } from 'express';
import {
  createListing,
  getListingsByBusiness,
  searchListings,
  getListingAvailability,
  updateListing,
  deleteListing,
} from '../controllers/listing.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Public Traveler Routes
router.get('/', searchListings);
router.get('/search', searchListings);
router.get('/business/:businessId', getListingsByBusiness);
router.get('/:id/availability', getListingAvailability);

// Owner Routes
router.post('/', createListing);
router.put('/:id', updateListing);
router.delete('/:id', deleteListing);

export default router;
