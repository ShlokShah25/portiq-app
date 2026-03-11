/**
 * Product variant: workplace (default) | education
 * Set REACT_APP_PRODUCT=education for build-time, or use selector on login to set portiq_product in localStorage.
 */
const STORAGE_KEY = 'portiq_product';
const getStored = () => typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
export const PRODUCT = getStored() || process.env.REACT_APP_PRODUCT || 'education';
export const isEducation = PRODUCT === 'education';

export function setProduct(product) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, product);
    window.location.reload();
  }
}
