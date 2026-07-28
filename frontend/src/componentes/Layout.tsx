import { NavLink, Outlet } from "react-router-dom";
import { useContextoApp } from "../contexto/ContextoApp";
import { MensajeError } from "./Mensaje";

const ENLACES = [
  { ruta: "/facturas", etiqueta: "Captura de factura" },
  { ruta: "/pagos", etiqueta: "Registro de pago" },
  { ruta: "/partidas-abiertas", etiqueta: "Partidas abiertas" },
  { ruta: "/antiguedad", etiqueta: "Antigüedad CxP" },
];

export function Layout(): React.JSX.Element {
  const {
    cargando,
    error,
    empresas,
    empresaId,
    setEmpresaId,
    sociedades,
    sociedadId,
    setSociedadId,
    usuario,
    setUsuario,
  } = useContextoApp();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-titulo">
          <span className="app-header-logo">ERP Financiero</span>
          <span className="app-header-subtitulo">Cuentas por Pagar</span>
        </div>

        <div className="app-header-selectores">
          <label>
            Empresa
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.codigo} — {e.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sociedad
            <select value={sociedadId} onChange={(e) => setSociedadId(e.target.value)}>
              {sociedades.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} — {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Usuario
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </label>
        </div>
      </header>

      <nav className="app-nav">
        {ENLACES.map((enlace) => (
          <NavLink
            key={enlace.ruta}
            to={enlace.ruta}
            className={({ isActive }) => "app-nav-enlace" + (isActive ? " activo" : "")}
          >
            {enlace.etiqueta}
          </NavLink>
        ))}
      </nav>

      <main className="app-main">
        {error && <MensajeError texto={error} />}
        {cargando && !error ? (
          <p className="texto-tenue">Cargando catálogos de la sociedad…</p>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
