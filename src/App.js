import React, { useState, useEffect, useRef } from 'react';

// Define regular expressions patterns for pathogenic variants
const pathogenicPattern = /(-VAR_)|(-[A-Z]\d+[A-Z])/;

// Main application component
const App = () => {
  // State to manage multiple file input sets
  // Each element in the array represents a "slot" for a sample with its files and name
  // Reverting to expect 'peptides' and 'proteins' files
  const [sampleInputs, setSampleInputs] = useState([{ id: 1, name: '', files: { peptides: null, proteins: null } }]);
  const [nextSampleInputId, setNextSampleInputId] = useState(2); // For unique slot IDs

  // State to store the results of already processed samples
  const [processedSamples, setProcessedSamples] = useState([]);
  // State for the IDs of samples selected for the comparative table and visualizations
  const [selectedProcessedSampleIds, setSelectedProcessedSampleIds] = useState([]);
  // State for the currently selected protein for the comparative bar chart
  const [selectedProteinForChart, setSelectedProteinForChart] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // State to indicate if export is in progress
  const [isExporting, setIsExporting] = useState(false);

  // State for Chart.js library loading
  const [isChartLibraryLoaded, setIsChartLibraryLoaded] = useState(false);
  // Ref for the comparative bar chart canvas and Chart.js instance
  const comparativeChartCanvasRef = useRef(null);
  const comparativeChartInstance = useRef(null);

  // Get selected samples for the comparative table and visualizations
  const samplesForComparison = processedSamples.filter(sample =>
    selectedProcessedSampleIds.includes(sample.id)
  );

  // Helper function to extract disease association
  const extractDiseaseAssociation = (description) => {
    let association = '';
    // Regex to find "Association:..." or "ClinicalSignificance:..."
    const associationMatch = description.match(/Association:([^|]+)/);
    const clinicalSigMatch = description.match(/ClinicalSignificance:([^|]+)/);

    if (associationMatch && associationMatch[1]) {
      association = associationMatch[1].trim();
    } else if (clinicalSigMatch && clinicalSigMatch[1]) {
      association = clinicalSigMatch[1].trim();
    }
    return association || 'N/A'; // Return N/A if no association is found
  };

  // Generate data for the comparative table, heatmap, and bar chart
  const getComparativeTableAndVisualizationData = () => {
    if (samplesForComparison.length === 0) return { headers: [], tableRows: [], visualizationData: [], uniqueProteinAccessions: [] };

    const uniqueProteinAccessions = new Set();
    const proteinDetailsMap = new Map(); // To store description, unique peptides, etc.
    let maxAbundance = 0; // To scale heatmap colors

    // Collect all unique pathogenic variants and their details from selected samples
    samplesForComparison.forEach(sample => {
      sample.analysisResults.forEach(result => {
        uniqueProteinAccessions.add(result['Protein Accession']);
        // Take details from the first sample where the protein is found
        if (!proteinDetailsMap.has(result['Protein Accession'])) {
          proteinDetailsMap.set(result['Protein Accession'], {
            description: result['Description'],
            totalPeptides: result['# Total Peptides'],
            uniquePeptidesCount: result['# Unique Peptides'],
            isUniqueGroup: result['Is Unique Group?'],
            peptidesList: result['Unique Peptides List'],
            diseaseAssociation: extractDiseaseAssociation(result['Description'])
          });
        }
        // Update max abundance for heatmap scaling
        if (result['Average Abundance'] > maxAbundance) {
          maxAbundance = result['Average Abundance'];
        }
      });
    });

    // Create the comparative table headers
    const headers = [
      "Protein Accession",
      "Description",
      "Disease Association / Clinical Significance",
      "# Total Peptides",
      "# Unique Peptides",
      "Is Unique Group?",
      "Unique Peptides List",
      ...samplesForComparison.map(sample => `Average Abundance (${sample.name})`)
    ];

    const tableRows = Array.from(uniqueProteinAccessions).map(accession => {
      const details = proteinDetailsMap.get(accession);
      const rowData = [
        accession,
        details.description,
        details.diseaseAssociation,
        details.totalPeptides,
        details.uniquePeptidesCount,
        details.isUniqueGroup ? 'Yes' : 'No',
        details.peptidesList
      ];
      // Add specific abundance for each sample
      samplesForComparison.forEach(sample => {
        const result = sample.analysisResults.find(res => res['Protein Accession'] === accession);
        rowData.push(result ? result['Average Abundance'].toFixed(2) : 'N/A');
      });
      return rowData;
    });

    // Data for heatmap and bar chart
    const visualizationData = Array.from(uniqueProteinAccessions).map(accession => {
        const abundancesBySample = {};
        samplesForComparison.forEach(sample => {
            const result = sample.analysisResults.find(res => res['Protein Accession'] === accession);
            abundancesBySample[sample.name] = result ? parseFloat(result['Average Abundance'].toFixed(2)) : 0;
        });
        return {
            proteinAccession: accession,
            abundancesBySample: abundancesBySample
        };
    });

    return { headers, tableRows, visualizationData, uniqueProteinAccessions: Array.from(uniqueProteinAccessions), maxAbundance };
  };

  const { headers: comparativeHeaders, tableRows: comparativeTableRows, visualizationData, uniqueProteinAccessions: allUniqueProteins, maxAbundance } = getComparativeTableAndVisualizationData();


  // useEffect to dynamically load Chart.js and verify its availability
  useEffect(() => {
    if (window.Chart) {
      setIsChartLibraryLoaded(true);
      return;
    }

    const chartjsUrl = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.7.0/chart.min.js';
    const script = document.createElement('script');
    script.src = chartjsUrl;
    script.id = 'chartjs-script';
    script.async = true;
    script.onload = () => {
      setIsChartLibraryLoaded(true);
    };
    script.onerror = () => {
      setError("Error loading Chart.js library. The chart will not be available.");
    };
    document.body.appendChild(script);

    return () => {
      const chartScript = document.getElementById('chartjs-script');
      if (chartScript && chartScript.parentNode) chartScript.parentNode.removeChild(chartScript);
    };
  }, []); 

  // useEffect to render/update the comparative bar chart
  useEffect(() => {
    if (comparativeChartCanvasRef.current && selectedProteinForChart && isChartLibraryLoaded && samplesForComparison.length > 0) {
      const proteinData = samplesForComparison.map(sample => {
        const result = sample.analysisResults.find(res => res['Protein Accession'] === selectedProteinForChart);
        return result ? parseFloat(result['Average Abundance'].toFixed(2)) : 0;
      });

      const labels = samplesForComparison.map(sample => sample.name);

      if (comparativeChartInstance.current) {
        comparativeChartInstance.current.destroy();
      }

      const ctx = comparativeChartCanvasRef.current.getContext('2d');
      comparativeChartInstance.current = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: `Average Abundance for ${selectedProteinForChart}`,
            data: proteinData,
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 1,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
            },
            title: {
              display: true,
              text: `Comparative Abundance for ${selectedProteinForChart}`,
            }
          },
          scales: {
            x: {
              title: {
                display: true,
                text: 'Sample',
              }
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Average Abundance (Normalized)',
              }
            }
          }
        }
      });
    } else {
      if (comparativeChartInstance.current) {
        comparativeChartInstance.current.destroy();
        comparativeChartInstance.current = null;
      }
    }

    return () => {
      if (comparativeChartInstance.current) {
        comparativeChartInstance.current.destroy();
        comparativeChartInstance.current = null;
      }
    };
  }, [selectedProteinForChart, samplesForComparison, isChartLibraryLoaded]);


  // Function to add a new sample input slot
  const addSampleInputSlot = () => {
    // Reverting to expect 'peptides' and 'proteins' files for each new slot
    setSampleInputs([...sampleInputs, { id: nextSampleInputId, name: '', files: { peptides: null, proteins: null } }]);
    setNextSampleInputId(nextSampleInputId + 1);
  };

  // Function to remove a sample input slot
  const removeSampleInputSlot = (id) => {
    setSampleInputs(sampleInputs.filter(slot => slot.id !== id));
    setSelectedProcessedSampleIds(prev => prev.filter(sampleId => sampleId !== id));
  };

  // Handler for changing the name for a specific slot
  const handleSampleNameChange = (id, newName) => {
    setSampleInputs(sampleInputs.map(slot => slot.id === id ? { ...slot, name: newName } : slot));
  };

  // Handler for changing files for a specific slot
  const handleSampleFileChange = (id, fileType, file) => {
    setSampleInputs(sampleInputs.map(slot =>
      slot.id === id ? { ...slot, files: { ...slot.files, [fileType]: file } } : slot // Fixed: Preserve slot properties including 'name'
    ));
  };

  // Function to read and parse a CSV file manually
  const parseCSV = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const rows = text.split('\n').filter(row => row.trim() !== '');
        if (rows.length === 0) {
          resolve([]);
          return;
        }
        const headers = rows[0].split(',').map(header => header.trim().replace(/"/g, ''));
        const data = [];
        for (let i = 1; i < rows.length; i++) {
          const values = rows[i].split(',');
          if (values.length !== headers.length) {
            console.warn(`Skipping row ${i + 1} due to column mismatch.`);
            continue; 
          }
          const rowObject = {};
          headers.forEach((header, index) => {
            rowObject[header] = values[index].trim().replace(/"/g, '');
          });
          data.push(rowObject);
        }
        resolve(data);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  // Function to process all configured samples - Reverting to original multi-file processing logic
  const processAllSamples = async () => {
    setLoading(true);
    setError(null);
    const newProcessedSamples = [];
    let hasError = false;

    for (const sampleInput of sampleInputs) {
      if (!sampleInput.name.trim()) {
        setError(`Error: Sample in slot ${sampleInput.id} does not have a valid name.`);
        hasError = true;
        break;
      }
      // Now checking for both peptides and proteins files
      if (!sampleInput.files.peptides || !sampleInput.files.proteins) {
        setError(`Error: Sample "${sampleInput.name}" does not have both 'Peptides File' and 'Proteins File' loaded.`);
        hasError = true;
        break;
      }
      if (newProcessedSamples.some(s => s.name === sampleInput.name.trim())) {
        setError(`Error: A sample with the name "${sampleInput.name}" already exists. Sample names must be unique.`);
        hasError = true;
        break;
      }

      try {
        const peptidesData = await parseCSV(sampleInput.files.peptides);
        const proteinsData = await parseCSV(sampleInput.files.proteins);

        // --- Original processing logic (Steps 1-6) ---

        // Step 1: Combine data
        const peptidesMap = new Map();
        peptidesData.forEach(p => {
          if (!peptidesMap.has(p['Protein Accession'])) peptidesMap.set(p['Protein Accession'], []);
          peptidesMap.get(p['Protein Accession']).push(p);
        });

        const proteinsMap = new Map();
        proteinsData.forEach(p => proteinsMap.set(p['Accession'], p));

        const mergedData = peptidesData.map(peptide => {
          const proteinInfo = proteinsMap.get(peptide['Protein Accession']);
          return {
            ...peptide,
            Description: proteinInfo ? proteinInfo.Description : '',
            Accession: proteinInfo ? proteinInfo.Accession : '',
            'Area IBIS_DDA_1': parseFloat(peptide['Area IBIS_DDA_1']) || 0,
            '-10lgP': parseFloat(peptide['-10lgP']) || 0,
          };
        });

        // Step 2: Data Normalization
        const totalArea = mergedData.reduce((sum, item) => sum + item['Area IBIS_DDA_1'], 0);
        const normFactor = totalArea > 0 ? 1000000 / totalArea : 1;
        
        const normalizedData = mergedData.map(item => ({
          ...item,
          'Area IBIS_DDA_1': item['Area IBIS_DDA_1'] * normFactor,
        }));

        // Step 3: Determine group uniqueness and unique peptides
        const proteinGroups = new Map();
        normalizedData.forEach(d => {
          const group = d['Protein Group'];
          if (!proteinGroups.has(group)) proteinGroups.set(group, new Set());
          proteinGroups.get(group).add(d['Protein Accession']);
        });

        const uniquePeptides = new Map();
        normalizedData.forEach(d => {
          if (d['Unique'] === 'Y') {
            if (!uniquePeptides.has(d['Protein Accession'])) uniquePeptides.set(d['Protein Accession'], new Set());
            uniquePeptides.get(d['Protein Accession']).add(d.Peptide);
          }
        });
        
        const processedData = normalizedData.map(d => ({
          ...d,
          'Is Protein Group Unique?': proteinGroups.get(d['Protein Group']).size === 1,
          'Unique Peptides List': Array.from(uniquePeptides.get(d['Protein Accession']) || []).join('; '),
          '# Unique Peptides': (uniquePeptides.get(d['Protein Accession']) || []).size,
        }));

        // Step 4: Select the most reliable protein per group
        const uniqueProteinsMap = new Map();
        processedData.forEach(item => {
          const group = item['Protein Group'];
          if (!uniqueProteinsMap.has(group) || item['-10lgP'] > uniqueProteinsMap.get(group)['-10lgP']) {
            uniqueProteinsMap.set(group, item);
          }
        });
        const uniqueProteins = Array.from(uniqueProteinsMap.values());
        
        // Step 5: Filter by pathogenic variants
        const pathogenicVariants = uniqueProteins.filter(p => 
          (p['Protein Accession'] && pathogenicPattern.test(p['Protein Accession'])) &&
          (p.Description && p.Description.includes('PATHOGENIC_VARIANT'))
        );

        // Step 6: Calculate average abundance and prepare results
        const finalResults = pathogenicVariants.map(variant => {
          const peptidesForVariant = processedData.filter(p => p['Protein Accession'] === variant['Protein Accession']);
          const totalPeptides = peptidesForVariant.length;
          const avgArea = totalPeptides > 0 ? peptidesForVariant.reduce((sum, p) => sum + p['Area IBIS_DDA_1'], 0) / totalPeptides : 0;
          const proteinsInGroup = proteinGroups.get(variant['Protein Group']).size;

          return {
            'Protein Accession': variant['Protein Accession'],
            'Description': variant.Description,
            'Average Abundance': avgArea,
            '# Total Peptides': totalPeptides,
            '# Unique Peptides': variant['# Unique Peptides'],
            '# Proteins in Group': proteinsInGroup,
            'Is Unique Group?': variant['Is Protein Group Unique?'],
            'Unique Peptides List': variant['Unique Peptides List'],
          };
        }).sort((a, b) => b['Average Abundance'] - a['Average Abundance']);


        newProcessedSamples.push({
          id: sampleInput.id,
          name: sampleInput.name.trim(),
          analysisResults: finalResults,
          totalPeptidesCount: peptidesData.length,
          totalProteinsCount: uniqueProteins.length,
          normalizationFactor: normFactor,
        });

      } catch (err) {
        console.error(`Error processing sample ${sampleInput.name}:`, err);
        setError(`An error occurred while processing sample "${sampleInput.name}". Please ensure both 'Peptides File' and 'Proteins File' are valid CSVs and contain expected columns. Specific error: ${err.message}`);
        hasError = true;
        break;
      }
    }

    if (!hasError) {
      setProcessedSamples(newProcessedSamples);
      // Select all processed samples by default for initial comparison
      setSelectedProcessedSampleIds(newProcessedSamples.map(s => s.id));
      if (newProcessedSamples.length > 0) {
        setError(null); // Clear any previous error if processing was successful
      } else {
        setError("No samples could be processed. Ensure all files are loaded and names are correct.");
      }
    }
    setLoading(false);
  };

  // Handler for selecting/deselecting samples for comparison
  const handleSelectSampleForComparison = (id) => {
    setSelectedProcessedSampleIds(prevSelected =>
      prevSelected.includes(id)
        ? prevSelected.filter(sampleId => sampleId !== id)
        : [...prevSelected, id]
    );
  };


  // Function to get color for heatmap cell based on abundance
  const getHeatmapColor = (abundance) => {
    if (abundance === 0) return 'rgba(240, 240, 240, 1)'; // Light gray for N/A or zero
    const hue = 210; // Blue hue
    const saturation = 80; // %
    const maxLightness = 95; // Lightest blue for lowest abundance (non-zero)
    const minLightness = 30; // Darkest blue for highest abundance

    const scaledAbundance = maxAbundance > 0 ? (abundance / maxAbundance) : 0;
    const lightness = maxLightness - (scaledAbundance * (maxLightness - minLightness));
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };


  // Function to export the comparative table to CSV
  const exportComparativeToCsv = () => {
    if (comparativeTableRows.length === 0) {
      setError("No comparative table data to export.");
      return;
    }
    setIsExporting(true);

    const csvRows = [];
    csvRows.push(comparativeHeaders.join(',')); // Add headers

    comparativeTableRows.forEach(row => {
      const formattedRow = row.map(cell => {
        // Ensure cells with commas or quotes are properly escaped
        if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      });
      csvRows.push(formattedRow.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'comparative_biomarker_analysis.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      setError("Your browser does not support direct file download.");
    }
    setIsExporting(false);
  };

  return (
    <div className="bg-gray-100 min-h-screen p-4 sm:p-8 font-sans">
      <div className="max-w-4xl mx-auto bg-white p-6 rounded-3xl shadow-lg">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-blue-700 mb-2">Multi-Sample Biomarker Analysis</h1>
        <p className="text-lg text-gray-600 mb-8">Load and compare the abundance of pathogenic proteins across different samples.</p>

        {/* Section to manage sample slots */}
        <div className="mb-8 p-6 bg-blue-50 rounded-3xl shadow-inner">
          <h2 className="text-xl font-bold text-blue-800 mb-4">Manage Samples</h2>
          {sampleInputs.map((sampleSlot, index) => (
            <div key={sampleSlot.id} className="mb-6 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <label htmlFor={`sampleName-${sampleSlot.id}`} className="block text-base font-medium text-gray-700">Sample {index + 1}</label>
                {sampleInputs.length > 1 && (
                  <button
                    onClick={() => removeSampleInputSlot(sampleSlot.id)}
                    className="text-red-600 hover:text-red-800 text-sm font-semibold"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                type="text"
                id={`sampleName-${sampleSlot.id}`}
                value={sampleSlot.name}
                onChange={(e) => handleSampleNameChange(sampleSlot.id, e.target.value)}
                placeholder="Sample Name (e.g., Control, Treated)"
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4"
              />
              <div className="space-y-3">
                <div className="p-2 bg-gray-50 rounded-xl border border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Peptides File (`protein-peptides.csv`)</label>
                  <input 
                    type="file" 
                    accept=".csv"
                    onChange={(e) => handleSampleFileChange(sampleSlot.id, 'peptides', e.target.files[0])} 
                    className="w-full text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
                  />
                </div>
                <div className="p-2 bg-gray-50 rounded-xl border border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Proteins File (`proteins.csv`)</label>
                  <input 
                    type="file" 
                    accept=".csv"
                    onChange={(e) => handleSampleFileChange(sampleSlot.id, 'proteins', e.target.files[0])} 
                    className="w-full text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={addSampleInputSlot}
            className="w-full py-2 px-4 bg-gray-200 text-gray-700 font-semibold rounded-2xl hover:bg-gray-300 transition-colors mb-4"
          >
            + Add Sample Slot
          </button>
          <button
            onClick={processAllSamples}
            disabled={loading || sampleInputs.some(s => !s.name.trim() || !s.files.peptides || !s.files.proteins)}
            className="w-full py-3 px-6 bg-blue-600 text-white font-bold rounded-2xl shadow-md hover:bg-blue-700 transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {loading && (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            <span>{loading ? "Processing Samples..." : "Process All Samples"}</span>
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-4 text-red-700 bg-red-100 rounded-2xl border border-red-200">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Sample Selector for Comparison */}
        {processedSamples.length > 0 && (
          <div className="mb-8 p-6 bg-gray-50 rounded-3xl shadow-inner">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Select Samples for Comparison</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {processedSamples.map(sample => (
                <label key={sample.id} className="inline-flex items-center p-2 bg-white rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedProcessedSampleIds.includes(sample.id)}
                    onChange={() => handleSelectSampleForComparison(sample.id)}
                    className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="ml-2 text-gray-700 font-medium">{sample.name}</span>
                </label>
              ))}
            </div>
            {selectedProcessedSampleIds.length > 0 && (
              <p className="text-sm text-gray-600 mt-4">Selected samples: {selectedProcessedSampleIds.length}</p>
            )}
          </div>
        )}
        
        {/* Visualizations Section */}
        {(visualizationData.length > 0 && isChartLibraryLoaded) && (
          <div className="mt-8 p-6 bg-gray-50 rounded-3xl shadow-inner">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Visualizations</h2>

            {/* Comparative Bar Chart */}
            <h3 className="text-xl font-bold text-gray-700 mb-4">Comparative Bar Chart (Select a Protein)</h3>
            <div className="mb-4">
              <label htmlFor="proteinForChart" className="block text-sm font-medium text-gray-700 mb-1">Select Protein Accession:</label>
              <select
                id="proteinForChart"
                value={selectedProteinForChart}
                onChange={(e) => setSelectedProteinForChart(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                disabled={!allUniqueProteins || allUniqueProteins.length === 0}
              >
                <option value="">-- Select a Protein --</option>
                {allUniqueProteins.map(accession => (
                  <option key={accession} value={accession}>{accession}</option>
                ))}
              </select>
            </div>
            {selectedProteinForChart && (
              <div className="mb-8 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm" style={{ height: '400px', width: '100%' }}>
                <canvas ref={comparativeChartCanvasRef}></canvas>
              </div>
            )}
            {!selectedProteinForChart && (
                <div className="mb-8 p-4 text-gray-600 bg-gray-100 rounded-2xl border border-gray-200">
                    <p className="font-semibold">Select a protein from the dropdown above to view its comparative abundance across samples.</p>
                </div>
            )}


            {/* Heatmap */}
            <h3 className="text-xl font-bold text-gray-700 mb-4 mt-8">Comparative Abundance Heatmap</h3>
            <div className="overflow-x-auto p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                {visualizationData.length > 0 && samplesForComparison.length > 0 ? (
                    <div className="inline-block min-w-full">
                        {/* Heatmap Header (Sample Names) */}
                        <div className="flex flex-row sticky top-0 bg-white z-10 border-b border-gray-200">
                            <div className="flex-shrink-0" style={{ width: '200px', padding: '8px', fontWeight: 'bold' }}>Protein Accession</div>
                            {samplesForComparison.map(sample => (
                                <div key={sample.id} className="flex-shrink-0 text-center" style={{ width: '100px', padding: '8px', fontWeight: 'bold' }}>{sample.name}</div>
                            ))}
                        </div>
                        {/* Heatmap Grid */}
                        {visualizationData.map((proteinRow, rowIndex) => (
                            <div key={rowIndex} className="flex flex-row border-b border-gray-100 hover:bg-gray-50">
                                <div className="flex-shrink-0 overflow-hidden whitespace-nowrap overflow-ellipsis" style={{ width: '200px', padding: '8px', borderRight: '1px solid #e5e7eb' }} title={proteinRow.proteinAccession}>
                                    {proteinRow.proteinAccession}
                                </div>
                                {samplesForComparison.map(sample => (
                                    <div 
                                        key={sample.id} 
                                        className="flex-shrink-0 text-center flex items-center justify-center text-xs font-mono" 
                                        style={{ 
                                            width: '100px', 
                                            padding: '8px', 
                                            backgroundColor: getHeatmapColor(proteinRow.abundancesBySample[sample.name]),
                                            color: proteinRow.abundancesBySample[sample.name] > maxAbundance / 2 ? 'white' : 'black', // Text color for contrast
                                            borderRight: '1px solid #e5e7eb'
                                        }}
                                        title={`Abundance: ${proteinRow.abundancesBySample[sample.name].toFixed(2)}`}
                                    >
                                        {proteinRow.abundancesBySample[sample.name] > 0 ? proteinRow.abundancesBySample[sample.name].toFixed(0) : 'N/A'}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-4 text-gray-600 bg-gray-100 rounded-2xl border border-gray-200">
                        <p className="font-semibold">No data available for heatmap. Process samples and select them for comparison.</p>
                    </div>
                )}
            </div>
          </div>
        )}
        {!visualizationData.length > 0 && processedSamples.length > 0 && (
             <div className="mt-8 p-4 text-gray-700 bg-gray-100 rounded-2xl border border-gray-200">
                <p className="font-semibold">Please select samples for comparison to generate visualizations.</p>
            </div>
        )}
        {(processedSamples.length > 0 && !isChartLibraryLoaded) && (
            <div className="mt-8 p-4 text-gray-700 bg-gray-100 rounded-2xl border border-gray-200">
                <p className="font-semibold">Loading chart library... Please wait for visualizations to appear.</p>
            </div>
        )}

        {/* Comparative Table Section */}
        {comparativeTableRows.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Comparative Abundance Table</h2>
            <p className="text-gray-600 mb-4 text-sm italic">
                Normalized abundances for the selected samples.
            </p>
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 mb-4">
              <button
                onClick={exportComparativeToCsv}
                disabled={isExporting || comparativeTableRows.length === 0}
                className="w-full py-3 px-6 bg-green-600 text-white font-bold rounded-2xl shadow-md hover:bg-green-700 transition-colors disabled:bg-green-300 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                <span>{isExporting ? "Exporting..." : "Export Comparative Table to Excel (CSV)"}</span>
              </button>
            </div>
            <div id="comparative-results-table" className="overflow-x-auto rounded-xl shadow-inner border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {comparativeHeaders.map((header, index) => (
                      <th key={index} className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {comparativeTableRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-gray-50 transition-colors">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className={`px-4 sm:px-6 py-4 whitespace-normal text-sm ${cellIndex < 2 ? 'font-medium text-gray-900' : 'text-gray-700 font-mono'}`}>{cell}</td>
                      ))}
                    </tr>
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
