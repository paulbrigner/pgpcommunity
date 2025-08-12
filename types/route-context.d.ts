import 'next';

declare module 'next' {
  export interface RouteContext<P = Record<string, string>> {
    params: P;
  }
}
