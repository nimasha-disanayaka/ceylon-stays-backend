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

// Protected Owner-Only Routes
router.post('/', authenticate, authorize(['OWNER']), createListing);
router.put('/:id', authenticate, authorize(['OWNER']), updateListing);
router.delete('/:id', authenticate, authorize(['OWNER']), deleteListing);

export default router;
