import React, { createContext, useContext, useMemo } from 'react';
import { isCura as isCuraBuild, PRODUCT } from '../config/product';

const CuraProductContext = createContext(null);

export function CuraProductProvider({ children, productType }) {
  const value = useMemo(() => {
    const server = String(productType || '').toLowerCase();
    const active = server === 'cura' || isCuraBuild || PRODUCT === 'cura';
    return {
      isCuraProduct: active,
      productType: active ? 'cura' : server || PRODUCT,
    };
  }, [productType]);

  return <CuraProductContext.Provider value={value}>{children}</CuraProductContext.Provider>;
}

export function useCuraProduct() {
  const ctx = useContext(CuraProductContext);
  return ctx || { isCuraProduct: isCuraBuild, productType: PRODUCT };
}
