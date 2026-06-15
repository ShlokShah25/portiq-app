/**
 * Product variant: workplace (default) | education | cura
 * Set REACT_APP_PRODUCT at build time, or portiq_product in localStorage after login.
 */
const STORAGE_KEY = 'portiq_product';
const getStored = () => (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null);

export const PRODUCT = getStored() || process.env.REACT_APP_PRODUCT || 'workplace';
export const isEducation = PRODUCT === 'education';
export const isCura = PRODUCT === 'cura';
export const isWorkplace = PRODUCT === 'workplace';

export function setProduct(product) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, product);
    window.location.reload();
  }
}

/** Default home route after login for the active product vertical. */
export function defaultHomePath(product = PRODUCT) {
  const p = String(product || '').toLowerCase();
  if (p === 'cura') return '/cura';
  if (p === 'education') return '/dashboard';
  return '/dashboard';
}
