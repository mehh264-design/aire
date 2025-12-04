const form = document.getElementById("consultaForm");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nic = document.getElementById("nic").value.trim();
    if (!nic) return alert("Ingresa un NIC");

    try {
        const res = await fetch(`/consulta?nic=${encodeURIComponent(nic)}`);
        const text = await res.text();

        procesarRespuesta(text);

    } catch (err) {
        console.error(err);
        alert("Error al conectar con el servidor");
    }
});

function procesarRespuesta(texto) {

    // Casos de error o sin deuda
    if (texto.includes("inexistente") || texto.includes("no es posible visualizar") || texto.includes("no cuenta con los permisos")) {
        alert("El NIC ingresado no existe o no está disponible.");
        return;
    }

    if (texto.includes("no presenta deuda") || texto.includes("La cuenta no presenta deuda")) {
        sessionStorage.setItem('aire_status', 'sin_deuda');
        sessionStorage.setItem('aire_data', null);
        window.location.href = 'formulario.html';
        return;
    }

    // Intentar parsear JSON real
    let raw;
    try {
        raw = JSON.parse(texto);
    } catch (e) {
        console.error("No se pudo leer JSON:", texto);
        alert("Respuesta inesperada del servidor.");
        return;
    }

    // Normalizar
    const cuenta = raw.ACCOUNTS || {};
    const factura = cuenta.INVOICES || {};

    const datos = {
        factura: factura.INVOICE_IDENTIFIER || "",
        valor: Number(factura.INVOICE_BALANCE || raw.BALANCE || 0),
        nombre: raw.NAME || "",
        nic: cuenta.ACCOUNT || "",
        direccion: cuenta.COLLECTION_ADDRESS || "",
        periodo: factura.SHORT_DESC_MONTH_BILL && factura.YEAR_FACT
            ? `${factura.SHORT_DESC_MONTH_BILL} ${factura.YEAR_FACT}`
            : ""
    };

    sessionStorage.setItem("aire_status", "con_deuda");
    sessionStorage.setItem("aire_data", JSON.stringify(datos));

    // Redirigir
    window.location.href = "formulario.html";
}
