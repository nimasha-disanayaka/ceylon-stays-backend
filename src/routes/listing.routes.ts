import { Router } from 'express';
import {
  createListing,
  getListingsByBusiness,
  searchListings,
  updateListing,
  deleteListing,
} from '../controllers/listing.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Public Traveler Routes
router.get('/search', searchListings);
router.get('/business/:businessId', getListingsByBusiness);

// Owner Routes
router.post('/', createListing);
router.put('/:id', updateListing);
router.delete('/:id', deleteListing);

export default router;
