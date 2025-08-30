import React, { useState, useEffect, useRef } from 'react';

// Define regular expressions patterns for pathogenic variants
const pathogenicPattern = /(-VAR_)|(-[A-Z]\d+[A-Z])/;

/**
 * @typedef {object} ProteinData - Formato de Datos Unificado (FDU) para una proteína.
 * @property {string} accession - ID de acceso principal de la proteína (ej: "P12345").
 * @property {string} description - Descripción completa de la proteína (ej: "Vimentin OS=Homo sapiens...").
 * @property {string} proteinGroup - El ID del grupo de proteínas al que pertenece.
 * @property {number} area - El valor de área de la proteína para la muestra cargada.
 * @property {number} totalPeptides - Número total de péptidos identificados para esta proteína.
 * @property {number} uniquePeptidesCount - Número de péptidos únicos.
 * @property {string[]} uniquePeptides - Lista de secuencias de péptidos únicos.
 * @property {string} sampleName - El nombre de la muestra de donde proviene la proteína.
 * @property {string} diseaseAssociation - Asociación de enfermedad extraída de la descripción.
 */

// Main application component
const App = () => {
  // State to manage multiple file input sets
  const [sampleInputs, setSampleInputs] = useState([{ id: 1, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
  const [processedData, setProcessedData] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [minArea, setMinArea] = useState(0);
  const [minPeptides, setMinPeptides] = useState(0);
  const [minUniquePeptides, setMinUniquePeptides] = useState(0);
  const [canonicalIds, setCanonicalIds] = useState('');
  const [filterPathogenic, setFilterPathogenic] = useState(false);
  const [copyMessage, setCopyMessage] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [idFile, setIdFile] = useState(null);

  // References for drag-and-drop
  const dragCounter = useRef(0);

  // Helper to parse CSV data
  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    const headers = lines[0].split('\t').map(h => h.trim());
    return lines.slice(1).map(line => {
      const values = line.split('\t');
      return headers.reduce((acc, header, i) => {
        acc[header] = values[i];
        return acc;
      }, {});
    });
  };

  // Function to extract disease association
  const extractDiseaseAssociation = (description) => {
      const associationMatch = description.match(/Association:([^|]+)/);
      if (associationMatch && associationMatch[1]) {
          return associationMatch[1].trim();
      }
      const clinicalMatch = description.match(/ClinicalSignificance:([^|]+)/);
      if (clinicalMatch && clinicalMatch[1]) {
          return clinicalMatch[1].trim();
      }
      return 'N/A';
  };

  // Function to process and unify data from multiple files
  const processData = async () => {
    setLoading(true);
    setError('');
    let allProcessedEntries = [];

    // Map to store unique peptides for each protein accession
    const uniquePeptidesMap = new Map();

    for (const sample of sampleInputs) {
      if (sample.files.peptides) {
        try {
          const peptidesContent = await sample.files.peptides.text();
          const peptidesData = parseCSV(peptidesContent);
          peptidesData.forEach(peptide => {
            const accession = peptide['Protein Accession'] || peptide['Protein ID'] || '';
            const isUnique = peptide['Unique'] === 'Y';
            const peptideSequence = peptide['Peptide'] || '';
            if (isUnique && accession && peptideSequence) {
              if (!uniquePeptidesMap.has(accession)) {
                uniquePeptidesMap.set(accession, new Set());
              }
              uniquePeptidesMap.get(accession).add(peptideSequence);
            }
          });
        } catch (err) {
          console.error('Error al procesar el archivo de péptidos:', err);
          // Don't halt, just log the error and continue
        }
      }

      if (sample.files.proteins) {
        try {
          const proteinsContent = await sample.files.proteins.text();
          const proteinData = parseCSV(proteinsContent);
          
          proteinData.forEach(protein => {
            const accession = protein['Accession'] || protein['Protein Accession'] || '';
            const description = protein['Description'] || '';
            const proteinGroup = protein['Protein Group'] || '';
            const areaKey = Object.keys(protein).find(key => key.includes('Area'));
            const area = areaKey ? parseFloat(protein[areaKey].replace(/,/g, '')) : 0;
            const totalPeptides = parseInt(protein['#Peptides'], 10) || 0;
            const uniquePeptidesCount = parseInt(protein['#Unique'], 10) || 0;
            const uniquePeptides = Array.from(uniquePeptidesMap.get(accession) || []);
            const diseaseAssociation = extractDiseaseAssociation(description);

            allProcessedEntries.push({
              accession,
              description,
              proteinGroup,
              area,
              totalPeptides,
              uniquePeptidesCount,
              uniquePeptides, // Add the unique peptides list
              sampleName: sample.name || `Muestra ${sample.id}`, // Add the sample name
              diseaseAssociation, // Add the extracted disease association
            });
          });
        } catch (err) {
          console.error(err);
          setError('Error al procesar el archivo de proteínas. Asegúrate de que el formato sea correcto.');
          setLoading(false);
          return;
        }
      }
    }

    // Aplicar filtros
    let filteredData = allProcessedEntries;
    
    if (filterPathogenic) {
        filteredData = filteredData.filter(protein => 
            (protein.accession && protein.accession.includes('PATHOGENIC_VARIANT')) ||
            (protein.description && protein.description.includes('PATHOGENIC_VARIANT'))
        );
    }
    
    if (minArea > 0) {
      filteredData = filteredData.filter(d => d.area >= minArea);
    }

    if (minPeptides > 0) {
      filteredData = filteredData.filter(d => d.totalPeptides >= minPeptides);
    }
    
    if (minUniquePeptides > 0) {
        filteredData = filteredData.filter(d => d.uniquePeptidesCount >= minUniquePeptides);
    }
    
    if (canonicalIds) {
        const idList = canonicalIds.split(',').map(id => id.trim().toLowerCase()).filter(id => id !== '');
        filteredData = filteredData.filter(d => 
            idList.some(id => d.accession.toLowerCase().includes(id) || d.proteinGroup.toLowerCase().includes(id))
        );
    }

    setProcessedData(filteredData);
    setLoading(false);
  };
  
  useEffect(() => {
    processData();
  }, [sampleInputs, minArea, minPeptides, minUniquePeptides, canonicalIds, filterPathogenic]);


  // Handlers for file input changes
  const handleFileChange = (e, id, type) => {
    const file = e.target.files[0];
    setSampleInputs(prevInputs =>
      prevInputs.map(input =>
        input.id === id ? { ...input, files: { ...input.files, [type]: file } } : input
      )
    );
  };

  const handleNameChange = (e, id) => {
    const name = e.target.value;
    setSampleInputs(prevInputs =>
      prevInputs.map(input =>
        input.id === id ? { ...input, name } : input
      )
    );
  };

  const handleIdFileChange = (e) => {
    setIdFile(e.target.files[0]);
  };
  
  // New function to handle loading IDs from the file
  const handleLoadIdsFromFile = async () => {
    if (!idFile) {
        setError('Por favor, selecciona un archivo de IDs primero.');
        return;
    }

    try {
        setLoading(true);
        const fileContent = await idFile.text();
        const regex = /\|([^|]+)\|/g; // Regex to find text between pipes
        const matches = [...fileContent.matchAll(regex)];
        const ids = matches.map(match => match[1]).join(', '); // Join with a comma for the input field
        setCanonicalIds(ids);
        setLoading(false);
        setError('');
    } catch (err) {
        setError('Error al leer el archivo de IDs. Asegúrate de que el formato sea correcto.');
        setLoading(false);
    }
  };

  const addSampleInput = () => {
    const newId = sampleInputs.length ? Math.max(...sampleInputs.map(s => s.id)) + 1 : 1;
    setSampleInputs(prevInputs => [...prevInputs, { id: newId, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
  };

  const removeSampleInput = (id) => {
    setSampleInputs(prevInputs => prevInputs.filter(input => input.id !== id));
  };
  
  // Handlers for drag-and-drop
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
  };

  const handleDragLeave = (e) => {
    e.stopPropagation();
    dragCounter.current--;
  };

  const handleDrop = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    
    const files = Array.from(e.dataTransfer.files);
    
    if (files.length > 0) {
        const peptidesFile = files.find(file => file.name.includes('peptides'));
        const proteinsFile = files.find(file => file.name.includes('proteins'));
        
        setSampleInputs(prevInputs =>
            prevInputs.map(input =>
                input.id === id
                ? {
                    ...input,
                    files: {
                        peptides: peptidesFile || input.files.peptides,
                        proteins: proteinsFile || input.files.proteins,
                    }
                }
                : input
            )
        );
    }
  };
  
  const handleCopyTable = () => {
    const table = document.getElementById('protein-table');
    if (table) {
        let text = '';
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('th, td');
            cells.forEach((cell, index) => {
                text += cell.innerText + (index < cells.length - 1 ? '\t' : '');
            });
            text += '\n';
        });

        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            setCopyMessage({ message: '¡Tabla copiada al portapapeles!', isError: false });
        } catch (err) {
            setCopyMessage({ message: 'Error al copiar la tabla.', isError: true });
        }
        document.body.removeChild(textarea);

        setTimeout(() => setCopyMessage(null), 3000);
    }
  };

  const toggleExpand = (index) => {
    setExpandedRow(expandedRow === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-8 flex flex-col items-center font-sans text-gray-800 dark:text-gray-200">
      <style>{`
        body {
          font-family: 'Inter', sans-serif;
        }
        tr.expanded-row td {
            background-color: #f3f4f6;
            border-top: 1px solid #e5e7eb;
            border-bottom: 1px solid #e5e7eb;
        }
        .dark tr.expanded-row td {
            background-color: #1f2937;
            border-top: 1px solid #374151;
            border-bottom: 1px solid #374151;
        }
      `}</style>
      <div className="w-full max-w-6xl bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 transition-colors duration-300">
        <h1 className="text-4xl font-extrabold text-center text-indigo-600 dark:text-indigo-400 mb-6">
          Análisis de Datos Proteómicos
        </h1>
        <p className="text-center text-lg mb-8 text-gray-600 dark:text-gray-400">
          Carga tus archivos de péptidos y proteínas para un análisis unificado.
        </p>

        {/* File Upload Section */}
        <div className="space-y-6 mb-8">
          {sampleInputs.map((sample, index) => (
            <div 
              key={sample.id} 
              className="bg-gray-50 dark:bg-gray-700 p-6 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col md:flex-row items-start md:items-center justify-between transition-colors duration-300"
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, sample.id)}
            >
              <div className="flex-1 w-full">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-gray-700 dark:text-gray-300">
                    Muestra {sample.id}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Arrastra y suelta tus archivos aquí, o haz clic para seleccionarlos.
                  </p>
                </div>
                <div className="mb-4">
                  <label htmlFor={`sample-name-${sample.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Nombre de la Muestra:
                  </label>
                  <input
                    id={`sample-name-${sample.id}`}
                    type="text"
                    value={sample.name}
                    onChange={(e) => handleNameChange(e, sample.id)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 p-2"
                    placeholder={`Muestra ${sample.id}`}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Archivo de Péptidos:
                    </label>
                    <input
                      type="file"
                      className="mt-1 w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                      onChange={(e) => handleFileChange(e, sample.id, 'peptides')}
                    />
                    {sample.files.peptides && <p className="text-xs text-green-500 mt-1">Cargado: {sample.files.peptides.name}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Archivo de Proteínas:
                    </label>
                    <input
                      type="file"
                      className="mt-1 w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                      onChange={(e) => handleFileChange(e, sample.id, 'proteins')}
                    />
                    {sample.files.proteins && <p className="text-xs text-green-500 mt-1">Cargado: {sample.files.proteins.name}</p>}
                  </div>
                </div>
              </div>
              {sampleInputs.length > 1 && (
                <button 
                  onClick={() => removeSampleInput(sample.id)}
                  className="mt-4 md:mt-0 md:ml-4 p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors duration-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          <button 
            onClick={addSampleInput} 
            className="w-full py-3 bg-indigo-500 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-600 transition-transform transform hover:-translate-y-1 duration-200"
          >
            Añadir Muestra
          </button>
        </div>

        {/* Filter and Action Section */}
        <div className="bg-gray-100 dark:bg-gray-700 p-6 rounded-xl shadow-inner mb-8 transition-colors duration-300">
          <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-300 mb-4">Opciones de Filtro</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="area" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Área Mínima:</label>
              <input
                id="area"
                type="number"
                value={minArea}
                onChange={(e) => setMinArea(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 p-2"
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="peptides" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Péptidos Totales Mínimos:</label>
              <input
                id="peptides"
                type="number"
                value={minPeptides}
                onChange={(e) => setMinPeptides(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 p-2"
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="unique-peptides" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Péptidos Únicos Mínimos:</label>
              <input
                id="unique-peptides"
                type="number"
                value={minUniquePeptides}
                onChange={(e) => setMinUniquePeptides(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 p-2"
                placeholder="0"
              />
            </div>
            <div className="flex items-center mt-6">
                <input
                    type="checkbox"
                    id="pathogenic-filter"
                    checked={filterPathogenic}
                    onChange={(e) => setFilterPathogenic(e.target.checked)}
                    className="h-5 w-5 text-indigo-600 rounded-md border-gray-300 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-indigo-400"
                />
                <label htmlFor="pathogenic-filter" className="ml-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Filtrar por 'PATHOGENIC_VARIANT'
                </label>
            </div>
          </div>

          <div className="mt-6">
            <label htmlFor="id-file" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Cargar archivo de IDs (FASTA/TXT):
            </label>
            <div className="flex items-center space-x-4 mt-1">
                <input
                  id="id-file"
                  type="file"
                  onChange={handleIdFileChange}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
                <button
                  onClick={handleLoadIdsFromFile}
                  className="py-2 px-4 bg-indigo-500 text-white rounded-xl shadow-lg hover:bg-indigo-600 transition-transform transform hover:-translate-y-1 duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading || !idFile}
                >
                  {loading ? 'Cargando...' : 'Cargar IDs del Archivo'}
                </button>
            </div>
            {idFile && <p className="text-xs text-green-500 mt-1">Cargado: {idFile.name}</p>}
          </div>

          <div className="mt-6">
              <label htmlFor="canonical-ids" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Buscar IDs Canónicas (separadas por comas):</label>
              <textarea
                id="canonical-ids"
                rows="3"
                value={canonicalIds}
                onChange={(e) => setCanonicalIds(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 p-2"
                placeholder="Ej: P0DJI8, P02766"
              />
          </div>

          <div className="mt-6 flex justify-center">
            <button
              onClick={processData}
              className="py-3 px-8 bg-green-500 text-white font-bold rounded-xl shadow-lg hover:bg-green-600 transition-transform transform hover:-translate-y-1 duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? 'Procesando...' : 'Analizar Datos'}
            </button>
          </div>
        </div>

        {/* Results Section */}
        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg mb-6" role="alert">
            <p className="font-bold">Error</p>
            <p>{error}</p>
          </div>
        )}

        {processedData.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-300 mb-4">Resultados</h2>
            <div className="flex justify-between items-center mb-4">
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Proteínas encontradas: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{processedData.length}</span>
              </p>
              <button
                onClick={handleCopyTable}
                className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md shadow hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"
              >
                Copiar Tabla
              </button>
            </div>
            
            {/* Protein Table */}
            <div className="overflow-x-auto bg-gray-50 dark:bg-gray-800 rounded-xl shadow-md">
              <table id="protein-table" className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-100 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Muestra</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Grupo Proteico</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Acceso</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Descripción</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Enfermedad Asociada</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Área</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Péptidos Totales</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Péptidos Únicos</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {processedData.map((protein, index) => (
                    <React.Fragment key={index}>
                      <tr 
                        onClick={() => toggleExpand(index)} 
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{protein.sampleName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{protein.proteinGroup}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{protein.accession}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{protein.description}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{protein.diseaseAssociation}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{protein.area.toFixed(2)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{protein.totalPeptides}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{protein.uniquePeptidesCount}</td>
                      </tr>
                      {expandedRow === index && (
                        <tr className="expanded-row">
                          <td colSpan="8" className="p-4">
                            <h4 className="text-md font-bold mb-2">Lista de Péptidos Únicos:</h4>
                            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                              {protein.uniquePeptides.length > 0 ? (
                                protein.uniquePeptides.map((peptide, pIndex) => (
                                  <li key={pIndex}>{peptide}</li>
                                ))
                              ) : (
                                <li>No hay péptidos únicos asociados.</li>
                              )}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Custom Copy Message */}
        {copyMessage && (
            <div className={`fixed bottom-4 right-4 p-3 rounded-lg shadow-lg text-white transition-opacity duration-300 ${copyMessage.isError ? 'bg-red-500' : 'bg-green-500'}`}>
                {copyMessage.message}
            </div>
        )}
      </div>
    </div>
  );
};

export default App;
