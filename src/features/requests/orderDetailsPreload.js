let orderDetailsScreenPromise = null;

export function preloadOrderDetailsScreen() {
  if (!orderDetailsScreenPromise) {
    orderDetailsScreenPromise = import('../../../screens/orders/OrderDetailsScreen');
  }
  return orderDetailsScreenPromise;
}
