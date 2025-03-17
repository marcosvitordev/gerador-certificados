const express = require("express");
const fs = require("fs");
const { PDFDocument, rgb } = require("pdf-lib");
const QRCode = require("qrcode");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const upload = multer();
const certificadosDir = "certificados";
const dataDir = "data";
const dbFile = `${dataDir}/data.json`;
const configFile = `${dataDir}/config.json`;

// Criar diretórios se não existirem
if (!fs.existsSync(certificadosDir)) fs.mkdirSync(certificadosDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify([]));
if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, JSON.stringify({ escola: "Nome da Escola", professor: "Nome do Professor" }));
}

// Middleware para servir arquivos estáticos
app.use("/certificados", express.static(path.join(__dirname, "certificados")));
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Rota para salvar configurações do painel administrativo
app.post("/salvar-config", (req, res) => {
    const { escola, professor } = req.body;
    fs.writeFileSync(configFile, JSON.stringify({ escola, professor }));
    res.json({ mensagem: "Configuração salva com sucesso!" });
});

// Rota para obter configurações
app.get("/config", (req, res) => {
    const config = JSON.parse(fs.readFileSync(configFile));
    res.json(config);
});

// Rota para gerar certificado em PDF
app.post("/gerar-certificado", upload.none(), async (req, res) => {
    const { nome, data_inicio, data_fim } = req.body;
    const { escola, professor } = JSON.parse(fs.readFileSync(configFile));

    if (!nome || !data_inicio || !data_fim) {
        return res.status(400).send("Nome, data de início e data de término são obrigatórios.");
    }

    try {
        const codigoAutenticidade = uuidv4();
        const urlQrCode = `http://localhost:3000/validar.html?codigo=${codigoAutenticidade}`;

        // Carregar modelo do certificado
        const modeloBytes = fs.readFileSync("modelo.pdf");
        const pdfDoc = await PDFDocument.load(modeloBytes);
        const page = pdfDoc.getPages()[0];

        // Adicionar informações ao certificado
        page.drawText(nome, { x: 150, y: 420, size: 24, color: rgb(0, 0, 0) });
        page.drawText(`Início: ${data_inicio}`, { x: 150, y: 380, size: 18, color: rgb(0, 0, 0) });
        page.drawText(`Término: ${data_fim}`, { x: 150, y: 350, size: 18, color: rgb(0, 0, 0) });
        page.drawText(`Código: ${codigoAutenticidade}`, { x: 150, y: 320, size: 14, color: rgb(0, 0, 0) });
        page.drawText(`Escola: ${escola}`, { x: 150, y: 280, size: 14, color: rgb(0, 0, 0) });
        page.drawText(`Professor: ${professor}`, { x: 150, y: 260, size: 14, color: rgb(0, 0, 0) });

        // Gerar e adicionar QR Code
        const qrCodeDataUrl = await QRCode.toDataURL(urlQrCode);
        const qrImage = await pdfDoc.embedPng(qrCodeDataUrl.split(",")[1], "base64");
        page.drawImage(qrImage, { x: 450, y: 250, width: 100, height: 100 });

        // Salvar PDF
        const filePath = path.join(certificadosDir, `${codigoAutenticidade}.pdf`);
        fs.writeFileSync(filePath, await pdfDoc.save());

        // Salvar no banco de dados
        const db = JSON.parse(fs.readFileSync(dbFile));
        db.push({ codigo: codigoAutenticidade, nome, data_inicio, data_fim, escola, professor, arquivo: filePath });
        fs.writeFileSync(dbFile, JSON.stringify(db));

        res.send({ mensagem: "Certificado gerado!", link: `/validar.html?codigo=${codigoAutenticidade}` });
    } catch (error) {
        console.error("Erro ao gerar certificado:", error);
        res.status(500).send("Erro ao gerar certificado.");
    }
});

// Rota para buscar certificado
app.get("/api/validar/:codigo", (req, res) => {
    const db = JSON.parse(fs.readFileSync(dbFile));
    const certificado = db.find(c => c.codigo === req.params.codigo);

    if (!certificado) {
        return res.status(404).json({ erro: "Certificado não encontrado, proucure o administrador ou a escola." });
    }

    res.json(certificado);
});

// Rota para baixar o certificado PDF
app.get("/download/:codigo", (req, res) => {
    const db = JSON.parse(fs.readFileSync(dbFile));
    const certificado = db.find(c => c.codigo === req.params.codigo);

    if (!certificado) {
        return res.status(404).send("Certificado não encontrado, proucure o administrador ou a escola.");
    }

    res.download(certificado.arquivo, `${certificado.nome}.pdf`);
});

// Iniciar servidor
app.listen(3000, () => {
    console.log("Servidor rodando em http://localhost:3000");
});
