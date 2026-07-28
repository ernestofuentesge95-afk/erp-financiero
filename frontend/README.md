# Frontend — Cuentas por Pagar

React + Vite + TypeScript. Consume la API del backend (`../`) vía el proxy de
Vite (`/api` → `http://localhost:3000`, ver `vite.config.ts`), así que el
backend no necesita CORS.

```bash
npm install
npm run dev      # http://localhost:5173, requiere el backend corriendo en :3000
npm run lint
npm run build
```

Pantallas: captura de factura de proveedor, registro de pago con
compensación de partidas, consulta de partidas abiertas, antigüedad de
saldos CxP.
