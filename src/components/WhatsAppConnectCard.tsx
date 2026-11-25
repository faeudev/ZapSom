import React, { useEffect } from "react";
import type { WhatsAppStatus } from "../lib/api";

interface WhatsAppConnectCardProps {
  waStatus: WhatsAppStatus;
  targetPhone: string;
  isBusy: boolean;
  onRefreshStatus: () => Promise<void>;
  onConnect: () => Promise<void>;
  onLogout: () => Promise<void>;
  onChangeTargetPhone: (val: string) => void;
}

export const WhatsAppConnectCard: React.FC<WhatsAppConnectCardProps> = ({
  waStatus,
  targetPhone,
  isBusy,
  onRefreshStatus,
  onConnect,
  onLogout,
  onChangeTargetPhone
}) => {
  useEffect(() => {
    const intervalMs =
      waStatus.status === "qr" || waStatus.status === "connecting"
        ? 1500
        : waStatus.status === "connected"
          ? 10_000
          : 0;

    if (!intervalMs) return;
    const id = window.setInterval(() => {
      onRefreshStatus().catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [waStatus.status, onRefreshStatus]);

  return (
    <section className="card wa-card">
      <div className="card-header">
        <div>
          <span className="step-pill">W</span>
          <h2>Conexão direta com WhatsApp</h2>
        </div>

        {waStatus.status === "connected" && (
          <span className="wa-pill connected">
            Conectado{waStatus.userPhone ? ` (+${waStatus.userPhone})` : ""}
          </span>
        )}
        {waStatus.status === "connecting" && (
          <span className="wa-pill connecting">Conectando...</span>
        )}
        {waStatus.status === "qr" && <span className="wa-pill qr">Escaneie o QR</span>}
        {waStatus.status === "disconnected" && (
          <span className="wa-pill disconnected">Desconectado</span>
        )}
      </div>

      {waStatus.lastError && <div className="banner error compact">{waStatus.lastError}</div>}

      {waStatus.status === "disconnected" && (
        <div className="wa-disconnected">
          <p className="wa-hint">
            Conecte seu WhatsApp uma única vez via QR Code para enviar a{" "}
            <strong>figurinha com som nativa (ícone 🔊)</strong> direto para a conversa{" "}
            <em>"Você mesmo"</em>.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={isBusy}
            onClick={onConnect}
          >
            📱 Conectar WhatsApp (QR Code)
          </button>
        </div>
      )}

      {waStatus.status === "connecting" && (
        <div className="wa-connecting-box">
          <p className="wa-hint">
            Iniciando sessão segura do WhatsApp Web local... Aguarde alguns segundos.
          </p>
          <button type="button" className="btn-link" disabled={isBusy} onClick={onLogout}>
            Cancelar
          </button>
        </div>
      )}

      {waStatus.status === "qr" && waStatus.qrDataUrl && (
        <div className="wa-qr-box">
          <img src={waStatus.qrDataUrl} alt="QR Code do WhatsApp" className="wa-qr-img" />
          <div className="wa-qr-steps">
            <p>
              <strong>Abra o WhatsApp no celular:</strong>
            </p>
            <ol>
              <li>
                Toque em <strong>Configurações</strong> (ou ⋮) →{" "}
                <strong>Aparelhos conectados</strong>
              </li>
              <li>
                Toque em <strong>Conectar aparelho</strong>
              </li>
              <li>Aponte a câmera para este QR Code</li>
            </ol>
            <button type="button" className="btn-link" onClick={onLogout}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {waStatus.status === "connected" && (
        <div className="wa-connected-box">
          <div className="wa-fields">
            <label>
              <span>Enviar para (opcional)</span>
              <input
                type="text"
                value={targetPhone}
                placeholder="Vazio = Você mesmo (ou 5511999998888)"
                onChange={(e) => onChangeTargetPhone(e.target.value)}
              />
            </label>
          </div>
          <div className="wa-connected-footer">
            <span className="wa-hint">
              {waStatus.userName ? `Conta: ${waStatus.userName} · ` : ""}
              {targetPhone.trim()
                ? `Destino: +${targetPhone.replace(/\D/g, "")}`
                : 'Destino: conversa "Você mesmo"'}
            </span>
            <button type="button" className="btn-link danger" disabled={isBusy} onClick={onLogout}>
              Desconectar WhatsApp
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
