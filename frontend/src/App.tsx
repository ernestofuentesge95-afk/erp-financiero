import { Navigate, Route, HashRouter, Routes } from "react-router-dom";
import { ProveedorContextoApp } from "./contexto/ContextoApp";
import { Layout } from "./componentes/Layout";
import { CapturaFacturaPagina } from "./paginas/CapturaFacturaPagina";
import { RegistroPagoPagina } from "./paginas/RegistroPagoPagina";
import { PartidasAbiertasPagina } from "./paginas/PartidasAbiertasPagina";
import { AntiguedadPagina } from "./paginas/AntiguedadPagina";
import { AuxiliarProveedorPagina } from "./paginas/AuxiliarProveedorPagina";

export default function App(): React.JSX.Element {
  return (
    <ProveedorContextoApp>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/facturas" replace />} />
            <Route path="/facturas" element={<CapturaFacturaPagina />} />
            <Route path="/pagos" element={<RegistroPagoPagina />} />
            <Route path="/partidas-abiertas" element={<PartidasAbiertasPagina />} />
            <Route path="/antiguedad" element={<AntiguedadPagina />} />
            <Route path="/auxiliar-proveedor" element={<AuxiliarProveedorPagina />} />
            <Route path="*" element={<Navigate to="/facturas" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ProveedorContextoApp>
  );
}
