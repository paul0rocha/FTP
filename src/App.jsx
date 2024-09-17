import { useState, useEffect } from 'react';
import './App.css';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import axios from 'axios';

function App() {
  const [csvData, setCsvData] = useState('');
  const [error, setError] = useState('');
  const [ftpFiles, setFtpFiles] = useState([]);
  const [recentFiles, setRecentFiles] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [fileToDelete, setFileToDelete] = useState('');
  const [dhlFiles, setDhlFiles] = useState([]);
  const [todayFiles, setTodayFiles] = useState([]);

  const fetchFiles = async () => {
    try {
      const [processadosResponse, recentsResponse, dhlResponse, todayFilesResponse] = await Promise.all([
        fetch('http://localhost:3000/list/files/processados/'),
        fetch('http://localhost:3000/list/files/recents/'),
        fetch('http://localhost:3000/list/files/dhl/'),
        fetch('http://localhost:3000/list/files/processados/today')
      ]);

      if (!processadosResponse.ok || !recentsResponse.ok || !dhlResponse.ok || !todayFilesResponse.ok) {
        throw new Error('Network response was not ok');
      }

      const processadosData = await processadosResponse.json();
      const recentsData = await recentsResponse.json();
      const dhlData = await dhlResponse.json();
      const todayFilesData = await todayFilesResponse.json();

      setFtpFiles(processadosData);
      setRecentFiles(recentsData);
      setDhlFiles(dhlData);
      setTodayFiles(todayFilesData);
      filterFilesByToday(processadosData);
    } catch (err) {
      setError(`Erro ao buscar arquivos do servidor: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchFiles(); // Fetch initially

    // Set up an interval to fetch files periodically
    const intervalId = setInterval(fetchFiles, 6000); // Refresh every 60 seconds

    // Clear interval on component unmount
    return () => clearInterval(intervalId);
  }, []);

  const formatDateBrazilian = (isoDateString) => {
    const date = new Date(isoDateString);

    // Ajusta para o fuso horário de Brasília (UTC-3)
    date.setHours(date.getHours() - 3);

    // Formata a data como dd/mm/yyyy hh:mm:ss
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  };

  const filterFilesByToday = (files) => {
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();

    const filtered = files.filter(file => {
      const fileDate = new Date(file.dateModified);
      return (
        fileDate.getFullYear() === todayYear &&
        fileDate.getMonth() === todayMonth &&
        fileDate.getDate() === todayDate
      );
    });

    setFilteredFiles(filtered);
  };

  const handleFileSelection = (event) => {
    const files = Array.from(event.target.files);
    setSelectedFiles(files);
    setError('');
  };

  const handleFileUpload = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);

    try {
      const formData = new FormData();

      for (const file of selectedFiles) {
        if (file.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
          setError('Please upload only XLSX files.');
          setIsUploading(false);
          return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          const csv = Papa.unparse(jsonData);

          const originalFileName = file.name.replace(/\.[^/.]+$/, "");
          const sanitizedFileName = originalFileName.replace(/\s+/g, '_').replace(/[^\w.]/g, '') + '.csv';

          const blob = new Blob([csv], { type: 'text/csv' });
          formData.append('files', blob, sanitizedFileName);
        };
        reader.readAsArrayBuffer(file);
      }

      setTimeout(async () => {
        try {
          const response = await axios.post('http://localhost:3000/upload/csv', formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            }
          });

          if (response.status === 200) {
            setSuccessMessage('Files uploaded successfully!');
            setError('');
          } else {
            setError('Error uploading files.');
            setSuccessMessage('');
          }
        } catch (err) {
          console.error('Error uploading files:', err);
          setError(`Error uploading files: ${err.message}`);
          setSuccessMessage('');
        } finally {
          setIsUploading(false);
          setSelectedFiles([]);
        }
      }, 1000);

    } catch (err) {
      console.error('Error processing files:', err);
      setError(`Error processing files: ${err.message}`);
      setSuccessMessage('');
      setIsUploading(false);
    }
  };

  const handleFileRemove = () => {
    setSelectedFiles([]);
    setCsvData('');
    setError('');
    setSuccessMessage('');
  };

  const handleClearDhlFolder = async () => {
    try {
      await axios.delete('http://localhost:3000/delete/all/dhl');
      setSuccessMessage('All files deleted from /DHL folder.');
      setError('');
      setDhlFiles([]);
    } catch (err) {
      setError(`Error clearing /DHL folder: ${err.message}`);
      setSuccessMessage('');
    }
  };

  const handleFileDelete = async () => {
    if (!fileToDelete) return;

    try {
      await axios.delete(`http://localhost:3000/delete/file/${fileToDelete}`);
      setSuccessMessage('File deleted successfully.');
      setError('');
      setDhlFiles(dhlFiles.filter(file => file.name !== fileToDelete));
    } catch (err) {
      setError(`Error deleting file: ${err.message}`);
      setSuccessMessage('');
    }
  };

  return (
    <div className="container">
      <h1 className="header">Envio de Rastreabilidade UMOVE</h1>
      <input 
        type="file" 
        accept=".xlsx" 
        onChange={handleFileSelection} 
        multiple
        className="file-input"
      />
      {selectedFiles.length > 0 && (
        <div className="file-info">
          <ul>
            {selectedFiles.map((file, index) => (
              <li key={index}><strong>Selected File:</strong> {file.name}</li>
            ))}
          </ul>
          <button onClick={handleFileRemove} className="remove-button">Remove All Files</button>
          <button onClick={handleFileUpload} className="upload-button" disabled={isUploading}>
            {isUploading ? 'Uploading...' : 'Upload Files'}
          </button>
        </div>
      )}
      {error && <p className={`error-message ${error ? 'fade-in' : ''}`}>{error}</p>}
      {successMessage && <p className={`success-message ${successMessage ? 'fade-in' : ''}`}>{successMessage}</p>}
     
      <h2>Recent Files</h2>
      <button onClick={handleClearDhlFolder} className="clear-button">
        Clear /DHL Folder
      </button>
      
      {recentFiles.length > 0 ? (
        <ul>
          {recentFiles.map((file, index) => (
            <li key={index}>
              <strong>{file.name}</strong> - {file.size} bytes - {formatDateBrazilian(file.dateModified)}
            </li>
          ))}
        </ul>
      ) : (
        <p>No recent files found.</p>
      )}
      
      <h2>Arquivos Processados Hoje</h2>
      {todayFiles.length > 0 ? (
        <ul>
          {todayFiles.map((file, index) => (
            <li key={index}>
              <strong>{file.name}</strong> - {file.size} bytes - {formatDateBrazilian(file.dateModified)}
            </li>
          ))}
        </ul>
      ) : (
        <p>Não há arquivos processados hoje.</p>
      )}

      <h2>Delete File from /DHL</h2>
      <div className="file-delete-container">
        <select 
          value={fileToDelete} 
          onChange={(e) => setFileToDelete(e.target.value)} 
          className="file-delete-dropdown"
        >
          <option value="">Select a file to delete</option>
          {dhlFiles.map((file, index) => (
            <option key={index} value={file.name}>
              {file.name}
            </option>
          ))}
        </select>
        <button onClick={handleFileDelete} className="delete-button">Delete Selected File</button>
      </div>
    </div>
  );
}

export default App;
