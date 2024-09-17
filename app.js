import express from 'express';
import ftp from 'basic-ftp';
import cors from 'cors';
import multer from 'multer';
import stream from 'stream';
import csv from 'csv-parser'; // Biblioteca para ler CSV

const app = express();
const port = 3000;

// Configura o middleware CORS para permitir requisições de diferentes origens
app.use(cors());

// Configuração da conexão FTP
const ftpConfig = {
  host: "files.umov.me",
  user: "master.nespressolog",
  password: "123",
  secure: false
};

// Configuração do multer para uploads de arquivos
const upload = multer({ storage: multer.memoryStorage() });

// Função para listar arquivos de uma pasta específica no FTP
const listFilesFromFtp = async (folderPath) => {
  const client = new ftp.Client();
  client.ftp.verbose = true; // Ativa o modo verbose para depuração detalhada

  try {
    await client.access(ftpConfig);

    // Lista os arquivos na pasta especificada
    const fileList = await client.list(folderPath);

    // Cria uma resposta detalhada
    return fileList.map(file => {
      // Verifica e converte a data para uma string legível
      const dateModified = file.date instanceof Date ? 
        file.date.toISOString() : 
        (typeof file.date === 'string' ? new Date(file.date).toISOString() : 'Data não disponível');

      return {
        name: file.name,
        size: file.size,
        isDirectory: file.isDirectory,
        dateModified
      };
    });
  } catch (err) {
    console.error('Error accessing FTP:', err);
    throw new Error(`Erro ao acessar o FTP: ${err.message}`);
  } finally {
    client.close();
  }
};

// Função para ler o conteúdo de um arquivo CSV e convertê-lo em JSON

// Endpoint para ler dados de arquivos CSV na pasta "/importacao/Processados"
app.get('/list/files/processados/csv', async (req, res) => {
  try {
    // Obtém a lista de arquivos na pasta "/importacao/Processados"
    const allFiles = await listFilesFromFtp("/DHL/importacao/Processados");

    // Filtra para pegar apenas arquivos CSV
    const csvFiles = allFiles.filter(file => !file.isDirectory && file.name.endsWith('.csv'));

    // Lê e retorna o conteúdo de cada arquivo CSV
    const fileDataPromises = csvFiles.map(file => readCsvFromFtp(`/DHL/importacao/Processa+dos/${file.name}`));
    const allFileData = await Promise.all(fileDataPromises);

    res.json(allFileData.flat());
  } catch (err) {
    res.status(500).send(err.message);
  }
});


// Endpoint para listar arquivos recentes na pasta "/DHL"
app.get('/list/files/recents', async (req, res) => {
  try {
    const detailedFileList = await listFilesFromFtp("/DHL");

    // Filtra arquivos para excluir "Erros Processados" e "padrao_2"
    const filteredFileList = detailedFileList.filter(file => 
      !["Erros","Processados", "padrao_2"].includes(file.name)
    );

    res.json(filteredFileList);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Endpoint para listar arquivos na pasta "/DHL"
app.get('/list/files/dhl', async (req, res) => {
  try {
    const detailedFileList = await listFilesFromFtp("/DHL");

    // Filtra arquivos para excluir "Erros Processados" e "padrao_2"
    const filteredFileList = detailedFileList.filter(file => 
      !["Erros","Processados", "padrao_2"].includes(file.name)
    );

    res.json(filteredFileList);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Endpoint para listar arquivos na pasta "/importacao/Processados"
app.get('/list/files/processados', async (req, res) => {
  try {
    const detailedFileList = await listFilesFromFtp("/importacao/Processados");
    res.json(detailedFileList);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Endpoint para listar arquivos processados hoje na pasta "/importacao/Processados"
app.get('/list/files/processados/today', async (req, res) => {
  try {
    const allFiles = await listFilesFromFtp("/importacao/Processados");

    // Obtém a data de hoje no formato YYYY-MM-DD no fuso horário de Brasília (GMT-3)
    const today = new Date();
    const startOfDay = new Date(today.setUTCHours(-3, 0, 0, 0));
    const endOfDay = new Date(today.setUTCHours(-3, 23, 59, 59, 999));

    // Ajusta o horário para o fuso horário de Brasília (GMT-3)
    const adjustedStartOfDay = new Date(startOfDay.getTime() - 3 * 60 * 60 * 1000);
    const adjustedEndOfDay = new Date(endOfDay.getTime() - 3 * 60 * 60 * 1000);

    // Filtra arquivos modificados hoje
    const todayFiles = allFiles.filter(file => {
      const fileDate = new Date(file.dateModified);
      const adjustedFileDate = new Date(fileDate.getTime() + 3 * 60 * 60 * 1000);
      return adjustedFileDate >= adjustedStartOfDay && adjustedFileDate <= adjustedEndOfDay;
    });

    res.json(todayFiles);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Endpoint para upload de múltiplos arquivos CSV
app.post('/upload/csv', upload.array('files'), async (req, res) => {
  const files = req.files;

  if (!files || files.length === 0 || !files.every(file => file.originalname.endsWith('.csv'))) {
    return res.status(400).send('Please upload valid CSV files.');
  }

  console.log('Received files:', files.map(file => file.originalname));

  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    await client.access(ftpConfig);

    // Envia cada arquivo para o FTP
    for (const file of files) {
      const fileStream = new stream.PassThrough();
      fileStream.end(file.buffer);

      console.log(`Uploading ${file.originalname} to FTP...`);
      await client.uploadFrom(fileStream, `/DHL/${file.originalname}`);
      console.log(`File ${file.originalname} uploaded successfully.`);
    }

    res.status(200).send('Files uploaded successfully.');
  } catch (err) {
    console.error('Error uploading files:', err);
    res.status(500).send(`Error uploading files: ${err.message}`);
  } finally {
    client.close();
  }
});

// Endpoint para remover um arquivo específico da pasta "/DHL"
app.delete('/delete/file/:filename', async (req, res) => {
  const { filename } = req.params;

  if (!filename) {
    return res.status(400).send('Filename is required.');
  }

  const client = new ftp.Client();
  client.ftp.verbose = true;
  
  try {
    await client.access(ftpConfig);

    console.log('Deleting file from FTP...');

    await client.remove(`/DHL/${filename}`);

    console.log('File deleted successfully.');
    res.status(200).send('File deleted successfully.');
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).send(`Error deleting file: ${err.message}`);
  } finally {
    client.close();
  }
});

// Endpoint para limpar todos os arquivos da pasta "/DHL"
app.delete('/delete/all/dhl', async (req, res) => {
  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    await client.access(ftpConfig);

    console.log('Listing files to delete from /DHL...');

    const fileList = await client.list('/DHL');

    for (const file of fileList) {
      if (!file.isDirectory) {
        await client.remove(`/DHL/${file.name}`);
        console.log(`Deleted ${file.name}`);
      }
    }

    console.log('All files deleted successfully.');
    res.status(200).send('All files deleted successfully.');
  } catch (err) {
    console.error('Error deleting files:', err);
    res.status(500).send(`Error deleting files: ${err.message}`);
  } finally {
    client.close();
  }
});

// Endpoint para ler dados de arquivos CSV na pasta "/importacao/Processados"
app.get('/list/files/processados/csv', async (req, res) => {
  try {
    const files = await listFilesFromFtp("/importacao/Processados");

    // Filtra para pegar apenas arquivos CSV
    const csvFiles = files.filter(file => !file.isDirectory && file.name.endsWith('.csv'));

    // Lê e retorna o conteúdo de cada arquivo CSV
    const fileDataPromises = csvFiles.map(file => readCsvFromFtp(`/importacao/Processados/${file.name}`));
    const allFileData = await Promise.all(fileDataPromises);

    res.json(allFileData.flat());
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
