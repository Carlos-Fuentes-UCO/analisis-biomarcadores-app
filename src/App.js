import React, { useState, useCallback, useMemo } from 'react';

// Regular expressions to find pathogenic variants and associations
const pathogenicPattern = /(-VAR_)|(-[A-Z]\d+[A-Z])/;
const associationPattern = /\| Association:(.*?)(?=\s*\||$)/;
const clinicalSignificancePattern = /\| ClinicalSignificance:(.*?)(?=\s*\||$)/;

/**
 * Helper function to dynamically find column indices from the header row.
 * @param {string} headerRow The raw header line from the file.
 * @param {string[]} columnsToFind An array of column names to find.
 * @returns {Object.<string, number>} An object mapping column names to their 0-based index.
 */
const getColumnIndices = (headerRow, columnsToFind) => {
  const headers = headerRow.split('\t').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const indices = {};
  columnsToFind.forEach(col => {
    indices[col] = headers.findIndex(h => h.includes(col.toLowerCase()));
  });
  return indices;
};

/**
 * A robust line parser that handles tabs within double-quoted fields.
 * @param {string} line The raw line from the file.
 * @returns {string[]} An array of columns.
 */
const parseLine = (line) => {
  // Regex to split by tab, but only if the tab is not inside double quotes.
  const regex = /\t(?=(?:[^"]*"[^"]*")*[^"]*$)/;
  return line.split(regex).map(col => col.replace(/"/g, '').trim());
};

const App = () => {
  const [sampleInputs, setSampleInputs] = useState([{ id: 1, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
  const [fastaFile, setFastaFile] = useState(null);
  const [fastaIds, setFastaIds] = useState(null);
  const [processedData, setProcessedData] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [minTotalPeptides, setMinTotalPeptides] = useState('');
  const [minArea, setMinArea] = useState('');
  const [minUniquePeptides, setMinUniquePeptides] = useState('');
  const [manualFastaIdsText, setManualFastaIdsText] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [showUnitaryGroupsOnly, setShowUnitaryGroupsOnly] = useState(false);

  const handleFileChange = (e, id, fileType) => {
    const file = e.target.files[0];
    setSampleInputs(prevInputs => prevInputs.map(input =>
      input.id === id ? { ...input, files: { ...input.files, [fileType]: file } } : input
    ));
  };

  const handleNameChange = (e, id) => {
    const { value } = e.target;
    setSampleInputs(prevInputs => prevInputs.map(input =>
      input.id === id ? { ...input, name: value } : input
    ));
  };

  const addSampleInput = () => {
    const newId = sampleInputs.length ? Math.max(...sampleInputs.map(s => s.id)) + 1 : 1;
    setSampleInputs([...sampleInputs, { id: newId, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
  };

  const handleRemoveInput = (id) => {
    if (sampleInputs.length > 1) {
      setSampleInputs(sampleInputs.filter(input => input.id !== id));
    }
  };

  const processData = useCallback(async () => {
    setError(null);
    setLoading(true);
    setProcessedData([]);
    setFastaIds(null);

    try {
      let parsedFastaIds = null;
      if (fastaFile) {
        const fastaText = await fastaFile.text();
        const ids = new Set();
        const lines = fastaText.split('\n');
        for (const line of lines) {
          if (line.startsWith('>')) {
            const parts = line.substring(1).split('|');
            if (parts.length > 1) {
              ids.add(parts[1].trim());
            } else {
              ids.add(parts[0].trim());
            }
          }
        }
        parsedFastaIds = ids;
      }

      const parsedManualIds = new Set();
      if (manualFastaIdsText.trim()) {
        const idsArray = manualFastaIdsText.split(/[\s,;]+/).map(id => id.trim()).filter(id => id.length > 0);
        idsArray.forEach(id => parsedManualIds.add(id));
      }

      let combinedFastaIds = null;
      if (parsedFastaIds || parsedManualIds.size > 0) {
        combinedFastaIds = new Set();
        if (parsedFastaIds) {
          parsedFastaIds.forEach(id => combinedFastaIds.add(id));
        }
        if (parsedManualIds.size > 0) {
          parsedManualIds.forEach(id => combinedFastaIds.add(id));
        }
      }
      setFastaIds(combinedFastaIds);
      
      const allProteins = [];
      const allPeptides = new Map();
      const sampleGroupCounts = new Map();

      for (const sample of sampleInputs) {
        if (!sample.name || !sample.files.peptides || !sample.files.proteins) {
          setError(`Missing information for sample ${sample.id}. Ensure the name and both files are uploaded.`);
          setLoading(false);
          return;
        }

        const peptidesText = await sample.files.peptides.text();
        const proteinsText = await sample.files.proteins.text();

        const peptidesLines = peptidesText.split('\n').filter(line => line.trim() !== '');
        const proteinsLines = proteinsText.split('\n').filter(line => line.trim() !== '');

        if (peptidesLines.length < 2 || proteinsLines.length < 2) {
          setError(`Error: Files for sample ${sample.name} are empty or the format is incorrect.`);
          setLoading(false);
          return;
        }

        const proteinsHeader = proteinsLines[0];
        const peptidesHeader = peptidesLines[0];

        const proteinsIndices = getColumnIndices(proteinsHeader, ['Accession', 'Protein Group', 'Area', '#Peptides', 'Description']);
        const peptidesIndices = getColumnIndices(peptidesHeader, ['Protein Accession', 'Peptide']);
        
        const missingProteinsCols = Object.entries(proteinsIndices).filter(([key, val]) => val === -1).map(([key]) => key);
        if (missingProteinsCols.length > 0) {
          setError(`Error: Protein file for sample '${sample.name}' does not contain the required columns: ${missingProteinsCols.join(', ')}.`);
          setLoading(false);
          return;
        }

        const missingPeptidesCols = Object.entries(peptidesIndices).filter(([key, val]) => val === -1).map(([key]) => key);
        if (missingPeptidesCols.length > 0) {
          setError(`Error: Peptide file for sample '${sample.name}' does not contain the required columns: ${missingPeptidesCols.join(', ')}.`);
          setLoading(false);
          return;
        }

        peptidesLines.slice(1).forEach(row => {
          const columns = row.split('\t');
          const peptideSequence = columns[peptidesIndices['Peptide']] || 'N/A';
          const proteinAccessionFull = columns[peptidesIndices['Protein Accession']] || '';
          const proteinAccession = proteinAccessionFull.split('|').length > 1 ? proteinAccessionFull.split('|')[1] : proteinAccessionFull;

          if (proteinAccession) {
            const peptideId = `${sample.name}-${proteinAccession}`;
            if (!allPeptides.has(peptideId)) {
                allPeptides.set(peptideId, new Set());
            }
            allPeptides.get(peptideId).add(peptideSequence);
          }
        });

        const parsedProteinsForThisSample = [];
        proteinsLines.slice(1).forEach(row => {
            const columns = parseLine(row);
            const accessionFull = columns[proteinsIndices['Accession']] || '';
            const accession = accessionFull.split('|').length > 1 ? accessionFull.split('|')[1] : accessionFull;
            const proteinGroup = columns[proteinsIndices['Protein Group']] || 'N/A';
            const area = parseFloat(columns[proteinsIndices['Area']]) || 0;
            const totalPeptides = parseInt(columns[proteinsIndices['#Peptides']], 10) || 0;
            
            const description = (columns[proteinsIndices['Description']] || '').replace(/"/g, '').trim();
            
            let diseaseAssociation = 'N/A';
            const associationMatch = description.match(associationPattern);
            const clinicalSignificanceMatch = description.match(clinicalSignificancePattern);
            const associations = [];
            if (associationMatch && associationMatch[1]) {
                associations.push(associationMatch[1].trim());
            }
            if (clinicalSignificanceMatch && clinicalSignificanceMatch[1]) {
                associations.push(clinicalSignificanceMatch[1].trim());
            }
            if (associations.length > 0) {
                diseaseAssociation = associations.join('; ');
            } else if (description.toUpperCase().includes('PATHOGENIC_VARIANT')) {
                diseaseAssociation = 'PATHOGENIC_VARIANT';
            } else if (description.match(pathogenicPattern)) {
                diseaseAssociation = 'Pathogenic/Variant';
            } else if (description.toLowerCase().includes('cancer')) {
                diseaseAssociation = 'Cancer';
            }
  
            const uniquePeptidesForProtein = Array.from(allPeptides.get(`${sample.name}-${accession}`) || []);
            const uniquePeptidesCount = uniquePeptidesForProtein.length;
  
            parsedProteinsForThisSample.push({
              accession,
              description,
              proteinGroup,
              area,
              totalPeptides,
              uniquePeptidesCount,
              uniquePeptides: uniquePeptidesForProtein,
              sampleName: sample.name,
              diseaseAssociation
            });
        });

        // Count protein groups per sample
        if (!sampleGroupCounts.has(sample.name)) {
            sampleGroupCounts.set(sample.name, new Map());
        }
        const currentSampleCounts = sampleGroupCounts.get(sample.name);
        parsedProteinsForThisSample.forEach(protein => {
            currentSampleCounts.set(protein.proteinGroup, (currentSampleCounts.get(protein.proteinGroup) || 0) + 1);
        });

        allProteins.push(...parsedProteinsForThisSample);
      }
      
      const finalProteins = allProteins.map(protein => ({
          ...protein,
          // Now we check the specific sample's group count
          isUnitaryGroup: sampleGroupCounts.get(protein.sampleName)?.get(protein.proteinGroup) === 1
      }));

      setProcessedData(finalProteins);

    } catch (err) {
      console.error('Error processing files:', err);
      setError(`Error processing files. Please ensure the format is correct. Details: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [sampleInputs, fastaFile, manualFastaIdsText]);

  const filteredData = useMemo(() => {
    let currentData = processedData;

    if (fastaIds && fastaIds.size > 0) {
        currentData = currentData.filter(protein => {
          const baseAccession = protein.accession.split('-')[0];
          return fastaIds.has(baseAccession);
        });
    }
    
    const parsedMinTotalPeptides = parseInt(minTotalPeptides, 10);
    if (!isNaN(parsedMinTotalPeptides)) {
        currentData = currentData.filter(protein => protein.totalPeptides >= parsedMinTotalPeptides);
    }
    
    const parsedMinArea = parseFloat(minArea);
    if (!isNaN(parsedMinArea)) {
        currentData = currentData.filter(protein => protein.area >= parsedMinArea);
    }
    
    const parsedMinUniquePeptides = parseInt(minUniquePeptides, 10);
    if (!isNaN(parsedMinUniquePeptides)) {
        currentData = currentData.filter(protein => protein.uniquePeptidesCount >= parsedMinUniquePeptides);
    }

    if (showUnitaryGroupsOnly) {
        currentData = currentData.filter(protein => protein.isUnitaryGroup);
    }

    return currentData.filter(protein =>
      protein.accession.toLowerCase().includes(searchTerm.toLowerCase()) ||
      protein.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [processedData, fastaIds, searchTerm, minTotalPeptides, minArea, minUniquePeptides, showUnitaryGroupsOnly]);

  const toggleRow = (index) => {
    setExpandedRow(expandedRow === index ? null : index);
  };
  
  const handleExportToTxt = () => {
    if (filteredData.length === 0) {
      setError('No data to export. Please ensure the table contains results.');
      return;
    }
  
    // Define the headers for the output file
    const headers = ['Accession ID', 'Description', 'Sample', 'Association', 'Unitary Group', 'Area', 'Total Peptides', 'Unique Peptides'];
    
    // Map the filtered data to a tab-separated string
    const rows = filteredData.map(protein => {
      return [
        protein.accession,
        protein.description,
        protein.sampleName,
        protein.diseaseAssociation,
        protein.isUnitaryGroup ? 'Yes' : 'No',
        protein.area.toFixed(2),
        protein.totalPeptides,
        protein.uniquePeptidesCount,
      ].join('\t');
    });
  
    // Combine headers and rows
    const fileContent = [headers.join('\t'), ...rows].join('\n');
    
    // Create a Blob and download it
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filtered_proteins.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-gray-100 min-h-screen py-8 font-sans">
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Pathogenic Variants Analysis</h1>
          <p className="text-lg text-gray-600">Unify, analyze, and visualize protein and peptide data from different samples.</p>
        </header>

        {/* FASTA Upload Section */}
        <div className="bg-white p-6 rounded-xl shadow-lg mb-8 border border-gray-200">
          <h2 className="text-2xl font-semibold text-gray-700 mb-4">Step 1: Optional - Filter by Protein IDs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col">
              <label className="text-gray-600 font-medium mb-2">Upload your FASTA file:</label>
              <input type="file" accept=".fasta,.txt" onChange={(e) => setFastaFile(e.target.files[0])} className="text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 transition duration-200" />
              {fastaFile && <p className="mt-2 text-sm text-gray-500">File selected: <span className="font-medium text-gray-700">{fastaFile.name}</span></p>}
            </div>
            <div className="flex flex-col">
              <label className="text-gray-600 font-medium mb-2">Or enter IDs manually (comma or space separated):</label>
              <textarea rows="4" value={manualFastaIdsText} onChange={(e) => setManualFastaIdsText(e.target.value)} placeholder="e.g. P01234, Q56789" className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200 resize-none"></textarea>
            </div>
          </div>
        </div>

        {/* Sample File Upload Section */}
        <div className="bg-white p-6 rounded-xl shadow-lg mb-8 border border-gray-200">
          <h2 className="text-2xl font-semibold text-gray-700 mb-4">Step 2: Upload Sample Files</h2>
          <div className="space-y-6">
            {sampleInputs.map((sample) => (
              <div key={sample.id} className="relative p-4 border border-gray-300 rounded-lg bg-gray-50 flex flex-col space-y-3">
                <input type="text" value={sample.name} onChange={(e) => handleNameChange(e, sample.id)} placeholder={`Sample Name ${sample.id}`} className="p-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200" />
                <div className="flex flex-col md:flex-row md:space-x-4 space-y-3 md:space-y-0">
                  <div className="flex-1">
                    <label className="block text-gray-600 text-sm mb-1">Peptide File:</label>
                    <input type="file" accept=".txt" onChange={(e) => handleFileChange(e, sample.id, 'peptides')} className="text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-200 hover:file:bg-gray-300 transition duration-200 w-full" />
                    <small className="mt-1 block text-gray-500 text-xs truncate">{sample.files.peptides?.name || 'Not selected'}</small>
                  </div>
                  <div className="flex-1">
                    <label className="block text-gray-600 text-sm mb-1">Protein File:</label>
                    <input type="file" accept=".txt" onChange={(e) => handleFileChange(e, sample.id, 'proteins')} className="text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-200 hover:file:bg-gray-300 transition duration-200 w-full" />
                    <small className="mt-1 block text-gray-500 text-xs truncate">{sample.files.proteins?.name || 'Not selected'}</small>
                  </div>
                </div>
                {sampleInputs.length > 1 && (
                  <button onClick={() => handleRemoveInput(sample.id)} className="absolute top-2 right-2 text-red-500 hover:text-red-700 transition duration-200 rounded-full w-6 h-6 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex space-x-4 mt-6">
            <button onClick={addSampleInput} className="bg-gray-200 text-gray-700 font-semibold py-2 px-6 rounded-full shadow-md hover:bg-gray-300 transition duration-200 ease-in-out transform hover:scale-105">
              Add Another Sample
            </button>
            <button onClick={processData} disabled={loading} className="bg-blue-600 text-white font-semibold py-2 px-6 rounded-full shadow-lg hover:bg-blue-700 transition duration-200 ease-in-out transform hover:scale-105 disabled:bg-blue-400">
              {loading ? 'Processing...' : 'Analyze Files'}
            </button>
          </div>
        </div>
        
        {error && <div className="bg-red-500 text-white p-4 rounded-lg shadow-md mb-8">{error}</div>}

        {/* Results Section */}
        {processedData.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Step 3: Results and Filters</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="col-span-1 md:col-span-2 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200" />
              <input type="number" placeholder="Min. Total Peptides" value={minTotalPeptides} onChange={(e) => setMinTotalPeptides(e.target.value)} className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200" />
              <input type="number" step="0.01" placeholder="Min. Area" value={minArea} onChange={(e) => setMinArea(e.target.value)} className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200" />
              <input type="number" placeholder="Min. Unique Peptides" value={minUniquePeptides} onChange={(e) => setMinUniquePeptides(e.target.value)} className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200" />
              <div className="flex items-center col-span-1 md:col-span-2 lg:col-span-1">
                <input
                  id="unitary-group-filter"
                  type="checkbox"
                  checked={showUnitaryGroupsOnly}
                  onChange={(e) => setShowUnitaryGroupsOnly(e.target.checked)}
                  className="h-4 w-4 text-blue-600 bg-gray-100 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="unitary-group-filter" className="ml-2 text-gray-600 font-medium cursor-pointer">
                  Only Unitary Groups
                </label>
              </div>
              <button onClick={handleExportToTxt} className="col-span-1 md:col-span-2 lg:col-span-1 bg-green-600 text-white font-semibold py-3 px-6 rounded-full shadow-lg hover:bg-green-700 transition duration-200 ease-in-out transform hover:scale-105">
                Export to TXT
              </button>
            </div>
            
            <div className="overflow-x-auto rounded-lg shadow-md">
              <table className="min-w-full bg-white border-collapse">
                <thead className="bg-gray-200 text-gray-700 uppercase text-sm leading-normal">
                  <tr>
                    <th className="py-3 px-6 text-left">Accession ID</th>
                    <th className="py-3 px-6 text-left">Description</th>
                    <th className="py-3 px-6 text-left">Sample</th>
                    <th className="py-3 px-6 text-left">Association</th>
                    <th className="py-3 px-6 text-left">Unitary Group</th>
                    <th className="py-3 px-6 text-left">Area</th>
                    <th className="py-3 px-6 text-left">Total Peptides</th>
                    <th className="py-3 px-6 text-left">Unique Peptides</th>
                    <th className="py-3 px-6 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 text-sm font-light">
                  {filteredData.map((protein, index) => (
                    <React.Fragment key={index}>
                      <tr className="border-b border-gray-200 hover:bg-gray-100 transition duration-200">
                        <td className="py-3 px-6 whitespace-nowrap">{protein.accession}</td>
                        <td className="py-3 px-6">{protein.description}</td>
                        <td className="py-3 px-6">{protein.sampleName}</td>
                        <td className="py-3 px-6">{protein.diseaseAssociation}</td>
                        <td className="py-3 px-6">{protein.isUnitaryGroup ? 'Yes' : 'No'}</td>
                        <td className="py-3 px-6">{protein.area.toFixed(2)}</td>
                        <td className="py-3 px-6">{protein.totalPeptides}</td>
                        <td className="py-3 px-6">{protein.uniquePeptidesCount}</td>
                        <td className="py-3 px-6">
                          <button onClick={() => toggleRow(index)} className="bg-blue-500 text-white py-1 px-3 rounded-full text-xs hover:bg-blue-600 transition duration-200">
                            {expandedRow === index ? 'Close' : 'View Peptides'}
                          </button>
                        </td>
                      </tr>
                      {expandedRow === index && (
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <td colSpan="9" className="p-4">
                            <h4 className="text-sm font-bold text-gray-700 mb-2">Unique Peptides:</h4>
                            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                              {protein.uniquePeptides.length > 0 ? (
                                protein.uniquePeptides.map((peptide, pIndex) => (
                                  <li key={pIndex}>{peptide}</li>
                                ))
                              ) : (
                                <li>No unique peptides associated.</li>
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
      </div>
    </div>
  );
};
        
export default App;
