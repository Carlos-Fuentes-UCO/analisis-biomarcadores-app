import React, { useState, useEffect, useRef } from 'react';

// Define regular expressions patterns for pathogenic variants
const pathogenicPattern = /(-VAR_)|(-[A-Z]\d+[A-Z])/;

// Main application component
const App = () => {
  // State to manage multiple file input sets
  const [sampleInputs, setSampleInputs] = useState([{ id: 1, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
  const [nextSampleInputId, setNextSampleInputId] = useState(2); // For unique slot IDs

  // State to store the results of already processed samples
  const [processedSamples, setProcessedSamples] = useState([]);
  // State for the IDs of samples selected for the comparative table and visualizations
  const [selectedProcessedSampleIds, setSelectedProcessedSampleIds] = useState([]);
  // State for the currently selected protein for the comparative bar chart
  const [selectedProteinForChart, setSelectedProteinForChart] = useState('');

  // New state for Venn Diagram sample selection
  const [selectedVennSampleIds, setSelectedVennSampleIds] = useState([]);
  const vennDiagramRef = useRef(null);
  const [isD3Loaded, setIsD3Loaded] = useState(false);
  const [isD3VennLoaded, setIsD3VennLoaded] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // State to indicate if export is in progress
  const [isExporting, setIsExporting] = useState(false);

  // State for Chart.js library loading
  const [isChartLibraryLoaded, setIsChartLibraryLoaded] = useState(false);
  // Ref for the comparative bar chart canvas and Chart.js instance
  const comparativeChartCanvasRef = useRef(null);
  const comparativeChartInstance = useRef(null);

  // State for Venn diagram tooltip
  const [tooltip, setTooltip] = useState(null); // { x, y, content, idList }
  // State for copy confirmation message
  const [copyMessage, setCopyMessage] = useState(null); // { message, visible, isError }


  // Get selected samples for the comparative table and visualizations
  const samplesForComparison = processedSamples.filter(sample =>
    selectedProcessedSampleIds.includes(sample.id)
  );

  // Helper function to extract disease association
  const extractDiseaseAssociation = (description) => {
    let association = '';
    const associationMatch = description.match(/Association:([^|]+)/);
    const clinicalSigMatch = description.match(/ClinicalSignificance:([^|]+)/);

    if (associationMatch && associationMatch[1]) {
      association = associationMatch[1].trim();
    } else if (clinicalSigMatch && clinicalSigMatch[1]) {
      association = clinicalSigMatch[1].trim();
    }
    return association || 'N/A';
  };

  // Generate data for the comparative table, heatmap, and bar chart
  const getComparativeTableAndVisualizationData = () => {
    if (samplesForComparison.length === 0) return { headers: [], tableRows: [], visualizationData: [], uniqueProteinAccessions: [] };

    const uniqueProteinAccessions = new Set();
    const proteinDetailsMap = new Map();
    let maxAbundance = 0;

    samplesForComparison.forEach(sample => {
      sample.analysisResults.forEach(result => {
        uniqueProteinAccessions.add(result['Protein Accession']);
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
        if (result['Average Abundance'] > maxAbundance) {
          maxAbundance = result['Average Abundance'];
        }
      });
    });

    const headers = [
      "Protein Accession",
      "Description",
      "Disease Association / Clinical Significance",
      "# Total Peptides",
      "Unique Peptides",
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
      samplesForComparison.forEach(sample => {
        const result = sample.analysisResults.find(res => res['Protein Accession'] === accession);
        rowData.push(result ? result['Average Abundance'].toFixed(2) : 'N/A');
      });
      return rowData;
    });

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
    } else {
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
    }
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
      if (comparativeChartInstance.current) {
        comparativeChartInstance.current.destroy();
        comparativeChartInstance.current = null;
      }
    };
  }, [selectedProteinForChart, samplesForComparison, isChartLibraryLoaded]);

  // Load D3 and D3-Venn libraries
  useEffect(() => {
    const loadScript = (id, src, globalObjectName) => {
      return new Promise((resolve, reject) => {
        // Check if global object already exists
        if (window[globalObjectName]) {
          console.log(`${globalObjectName} already loaded.`);
          resolve(true);
          return;
        }

        let script = document.getElementById(id);
        if (script) {
          console.log(`Script tag ${id} already exists, waiting for ${globalObjectName}.`);
          // If script exists but global object isn't there, poll for it
          const checkGlobal = setInterval(() => {
            if (window[globalObjectName]) {
              clearInterval(checkGlobal);
              resolve(true);
            }
          }, 50); // Check every 50ms
          return;
        }

        script = document.createElement('script');
        script.src = src;
        script.id = id;
        script.async = true;
        script.onload = () => {
          console.log(`Script ${id} loaded, checking for ${globalObjectName}...`);
          // After script loads, poll for the global object to be defined
          const checkGlobal = setInterval(() => {
            if (window[globalObjectName]) {
              clearInterval(checkGlobal);
              resolve(true);
            }
          }, 50); // Check every 50ms
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
      });
    };

    const loadAllVennLibraries = async () => {
      try {
        setError(null); // Clear any previous errors before trying to load

        // Load D3 first, wait for window.d3 to be available
        if (!window.d3) { // Only attempt to load if window.d3 is not yet available
          console.log("Attempting to load D3...");
          await loadScript('d3-script', 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js', 'd3');
          setIsD3Loaded(true);
          console.log("D3 loaded successfully.");
        } else if (!isD3Loaded) { // D3 is in window, but state isn't updated
          setIsD3Loaded(true);
          console.log("D3 already available, state updated.");
        }

        // Load D3-Venn only if D3 is loaded and D3-Venn isn't already there
        // Use window.d3 to confirm D3 is available before trying to load D3-Venn
        if (window.d3 && !window.venn) { // Only attempt to load if window.venn is not yet available
          console.log("Attempting to load D3-Venn...");
          // Switched CDN for d3-venn to cdnjs
          await loadScript('d3-venn-script', 'https://cdnjs.cloudflare.com/ajax/libs/venn.js/0.2.14/venn.min.js', 'venn');
          setIsD3VennLoaded(true);
          console.log("D3-Venn loaded successfully.");
        } else if (window.d3 && window.venn && !isD3VennLoaded) { // D3 and Venn are in window, but state isn't updated
          setIsD3VennLoaded(true);
          console.log("D3-Venn already available, state updated.");
        }

      } catch (err) {
        console.error("Error loading Venn libraries:", err);
        setError(`Error cargando librerías para el diagrama de Venn: ${err.message}. Asegúrate de que tienes conexión a internet.`);
      }
    };

    loadAllVennLibraries(); // Execute the async loading function

    return () => {
      // Cleanup: remove the scripts if the component unmounts
      // Only remove if they were actually added by this component and are not needed elsewhere
      const d3Script = document.getElementById('d3-script');
      if (d3Script && d3Script.parentNode) d3Script.parentNode.removeChild(d3Script);
      const vennScript = document.getElementById('d3-venn-script');
      if (vennScript && vennScript.parentNode) vennScript.parentNode.removeChild(vennScript);
    };
  }, [isD3Loaded, isD3VennLoaded]); // ADDED isD3Loaded, isD3VennLoaded


  // Generate Venn diagram data (sets and overlaps)
  const generateVennDiagramData = () => {
    if (selectedVennSampleIds.length < 2 || selectedVennSampleIds.length > 3) {
      // Clean up SVG if fewer than 2 or more than 3 samples are selected
      window.d3?.select(vennDiagramRef.current)?.select('svg')?.remove();
      return { sets: [], overlaps: [] };
    }

    const selectedVennSamples = processedSamples.filter(sample =>
      selectedVennSampleIds.includes(sample.id)
    );

    // Ensure labels are unique by appending ID if names are duplicated
    const labelMap = new Map();
    const proteinSetsIntermediate = selectedVennSamples.map(sample => {
      let baseLabel = sample.name.trim();
      if (!baseLabel) {
        baseLabel = `Sample ${sample.id}`; // Fallback if name is empty
      }

      let currentLabel = baseLabel;
      let count = 1;
      // Ensure unique label for Venn diagram (d3-venn expects unique set labels)
      while (labelMap.has(currentLabel)) {
        count++;
        currentLabel = `${baseLabel} (${count})`;
      }
      labelMap.set(currentLabel, true); // Mark this unique label as used

      const proteinAccessions = new Set(sample.analysisResults.map(r => r['Protein Accession']));
      return { label: currentLabel, size: Number(proteinAccessions.size), proteins: proteinAccessions };
    });

    const allVennData = [];

    // Add individual sets to allVennData in d3-venn format { sets: ["label"], size: N, proteins: Set }
    proteinSetsIntermediate.forEach(pSet => {
      allVennData.push({ sets: [pSet.label], size: pSet.size, proteins: pSet.proteins });
    });

    // Calculate pairwise overlaps
    for (let i = 0; i < proteinSetsIntermediate.length; i++) {
      for (let j = i + 1; j < proteinSetsIntermediate.length; j++) {
        const set1 = proteinSetsIntermediate[i];
        const set2 = proteinSetsIntermediate[j];
        const intersection = new Set([...set1.proteins].filter(x => set2.proteins.has(x)));
        allVennData.push({ sets: [set1.label, set2.label], size: Number(intersection.size), proteins: intersection });
      }
    }

    // Calculate triplet overlap if 3 samples are selected
    if (proteinSetsIntermediate.length === 3) {
      const set1 = proteinSetsIntermediate[0];
      const set2 = proteinSetsIntermediate[1];
      const set3 = proteinSetsIntermediate[2];

      const intersection12 = new Set([...set1.proteins].filter(x => set2.proteins.has(x)));
      const intersection123 = new Set([...intersection12].filter(x => set3.proteins.has(x)));
      
      allVennData.push({ sets: [set1.label, set2.label, set3.label], size: Number(intersection123.size), proteins: intersection123 });
    }

    // Filter to ensure all objects have valid 'sets' and 'size' properties, and 'proteins' is a Set
    const finalVennData = allVennData.filter(d =>
      d && Array.isArray(d.sets) && d.sets.every(s => typeof s === 'string' && s.length > 0) &&
      typeof d.size === 'number' && !isNaN(d.size) &&
      d.proteins instanceof Set
    );

    return { sets: proteinSetsIntermediate, overlaps: finalVennData };
  };

  const { sets: vennSets, overlaps: vennOverlaps } = generateVennDiagramData();

  // Render Venn Diagram
  useEffect(() => {
    // Only attempt to render if the necessary libraries are loaded, the ref exists,
    // and there's valid data for the Venn diagram.
    if (vennDiagramRef.current && vennOverlaps.length > 0 && isD3Loaded && isD3VennLoaded && window.d3 && window.venn) {
      console.log("Rendering Venn Diagram. vennSets (for debug, not direct use):", vennSets);
      console.log("Rendering Venn Diagram. vennOverlaps (final data for datum):", vennOverlaps); // Debug log

      // Clear previous SVG content to prevent multiple diagrams stacking
      window.d3.select(vennDiagramRef.current).select('svg').remove();
      
      const chart = window.venn.VennDiagram()
                                  .width(600)
                                  .height(400)
                                  .fontSize("14px")
                                  .padding(15);

      const svg = window.d3.select(vennDiagramRef.current)
        .append("svg")
        .attr("width", 600)
        .attr("height", 400);

      // Pass the combined and filtered data to d3-venn
      svg.datum(vennOverlaps).call(chart);

      // Customize text and circles for better readability and aesthetics
      svg.selectAll(".venn-circle path")
        .style("fill-opacity", 0.6)
        .style("stroke-width", 2)
        .style("stroke-opacity", 0.8)
        .style("stroke", "#fff"); // White stroke for better separation

      svg.selectAll(".venn-set-label")
        .style("fill", "#333")
        .style("font-weight", "bold");

      svg.selectAll(".venn-intersection-label")
        .style("fill", "#666");

      // Add interactive events for Venn areas
      svg.selectAll("g.venn-area")
        .on("mouseover", function(event, d) {
            if (!d.proteins) return; // Guard against missing protein data
            const proteinsArray = Array.from(d.proteins);
            const sampleIds = proteinsArray.slice(0, 5).join(', ') + (proteinsArray.length > 5 ? '...' : '');
            const content = `<span class="font-bold">Count:</span> ${d.size}<br/><span class="font-bold">IDs (muestra):</span> ${sampleIds}`;
            setTooltip({
                x: event.pageX + 10,
                y: event.pageY - 20,
                content: content,
                idList: proteinsArray // Store full list for copying
            });
            window.d3.select(this).select("path").style("fill-opacity", 0.75); // Highlight
        })
        .on("mousemove", function(event) {
            if (tooltip) { // Only update position if tooltip is already active
                setTooltip(prev => prev ? { ...prev, x: event.pageX + 10, y: event.pageY - 20 } : null);
            }
        })
        .on("mouseout", function() {
            setTooltip(null);
            window.d3.select(this).select("path").style("fill-opacity", 0.6); // De-highlight
        })
        .on("click", function(event, d) {
            if (!d.proteins) return; // Guard against missing protein data
            const proteinsArray = Array.from(d.proteins);
            const idString = proteinsArray.join('\n');
            navigator.clipboard.writeText(idString).then(() => {
                setCopyMessage({ message: `¡Copiados ${proteinsArray.length} IDs de proteínas al portapapeles!`, visible: true });
                setTimeout(() => setCopyMessage(null), 3000); // Hide after 3 seconds
            }).catch(err => {
                console.error('Error copying to clipboard:', err);
                setCopyMessage({ message: 'Error al copiar IDs al portapapeles.', visible: true, isError: true });
                setTimeout(() => setCopyMessage(null), 3000);
            });
        });

    } else if (vennDiagramRef.current) {
        // Clear SVG if conditions for rendering are not met (e.g., no data, or less than 2/more than 3 selected samples)
        window.d3?.select(vennDiagramRef.current)?.select('svg')?.remove();
        setTooltip(null); // Hide tooltip if diagram is cleared
    }
  }, [vennOverlaps, isD3Loaded, isD3VennLoaded, tooltip, vennSets]); // ADDED vennSets

  // Function to add a new sample input slot
  const addSampleInputSlot = () => {
    setSampleInputs([...sampleInputs, { id: nextSampleInputId, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
    setNextSampleInputId(nextSampleInputId + 1);
  };

  // Function to remove a sample input slot
  const removeSampleInputSlot = (id) => {
    setSampleInputs(sampleInputs.filter(slot => slot.id !== id));
    setProcessedSamples(prev => prev.filter(sample => sample.id !== id)); // Also remove from processed
    setSelectedProcessedSampleIds(prev => prev.filter(sampleId => sampleId !== id));
    setSelectedVennSampleIds(prev => prev.filter(sampleId => sampleId !== id)); // Also remove from Venn selection
  };

  // Handler for changing the name for a specific slot
  const handleSampleNameChange = (id, newName) => {
    setSampleInputs(sampleInputs.map(slot => slot.id === id ? { ...slot, name: newName } : slot));
    setProcessedSamples(prev => prev.map(sample => sample.id === id ? { ...sample, name: newName } : sample)); // Update name in processed too
  };

  // Handler for changing the source software for a specific slot
  const handleSourceSoftwareChange = (id, newSoftware) => {
    setSampleInputs(sampleInputs.map(slot =>
      slot.id === id
        ? { ...slot, sourceSoftware: newSoftware, files: { peptides: null, proteins: null } }
        : slot
    ));
    // Reset files when software changes to avoid incompatible file processing
  };

  // Handler for changing files for a specific slot
  const handleSampleFileChange = (id, fileType, file) => {
    setSampleInputs(sampleInputs.map(slot =>
      slot.id === id ? { ...slot, files: { ...slot.files, [fileType]: file } } : slot
    ));
  };

  // Handler for selecting/deselecting samples for Venn Diagram
  const handleSelectVennSample = (id) => {
    setSelectedVennSampleIds(prevSelected => {
      if (prevSelected.includes(id)) {
        return prevSelected.filter(sampleId => sampleId !== id);
      } else {
        // Limit to 3 samples for Venn
        if (prevSelected.length < 3) {
          return [...prevSelected, id];
        } else {
          setError("Solo puedes seleccionar hasta 3 muestras para el diagrama de Venn.");
          return prevSelected;
        }
      }
    });
  };

  // Function to read and parse a CSV/TSV file manually
  const parseCSV = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        
        // Debugging: Log first few chars and their hex codes
        const firstChars = text.substring(0, Math.min(text.length, 200)); // Log more characters
        const firstCharsHex = Array.from(firstChars).map(c => c.charCodeAt(0).toString(16)).join(' ');
        console.log(`parseCSV: First ${Math.min(text.length, 200)} chars of file (${file.name}): "${firstChars}" (Hex: ${firstCharsHex})`);

        const rows = text.split(/\r?\n/).filter(row => row.trim() !== ''); // Split by new line, handle both \r\n and \n, and filter out empty lines
        if (rows.length === 0) {
          console.warn(`parseCSV: File ${file.name} is empty after splitting into rows.`);
          resolve([]);
          return;
        }
        
        // Debugging: Log raw first row before splitting by delimiter
        console.log(`parseCSV: Raw first row of ${file.name}: "${rows[0]}"`);

        // --- Delimiter Detection ---
        let detectedDelimiter = ','; // Default to comma
        if (rows[0].includes('\t')) {
            const commaCount = (rows[0].match(/,/g) || []).length;
            const semicolonCount = (rows[0].match(/;/g) || []).length;
            const tabCount = (rows[0].match(/\t/g) || []).length;

            if (tabCount > Math.max(commaCount, semicolonCount)) {
                detectedDelimiter = '\t';
            } else if (semicolonCount > commaCount) {
                detectedDelimiter = ';';
            }
        } else if (rows[0].includes(';')) { // If no tabs, check for semicolons
            detectedDelimiter = ';';
        }
        console.log(`parseCSV: Detected delimiter for ${file.name}: "${detectedDelimiter}"`);
        // --- End Delimiter Detection ---


        const headers = rows[0].split(detectedDelimiter).map(header => header.trim().replace(/"/g, ''));
        console.log("parseCSV headers:", headers); // Debugging: Log parsed headers
        const data = [];
        for (let i = 1; i < rows.length; i++) {
          const values = rows[i].split(detectedDelimiter); // Use detected delimiter
          // Only process rows with the correct number of columns
          if (values.length !== headers.length) {
            console.warn(`Skipping row ${i + 1} of ${file.name} due to column mismatch (expected ${headers.length}, got ${values.length}). Row content: "${rows[i]}"`);
            continue; 
          }
          const rowObject = {};
          headers.forEach((header, index) => {
            // Replace comma decimal separators with dots for numeric conversion
            const rawValue = values[index].trim().replace(/"/g, '');
            rowObject[header] = rawValue.replace(/,/g, '.'); // Store all values as strings with dot decimals for consistent parsing later
          });
          data.push(rowObject);
          if (i === 1) { // Log first data row
            console.log("parseCSV first data row object:", rowObject); // Debugging: Log first data row object
          }
        }
        resolve(data);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  // --- Adapter Functions for Different Software Formats ---
  // Each function takes raw parsed data (peptides, proteins) and transforms it into a common internal format.
  // The common format should have: proteinAccession, description, totalPeptides, uniquePeptidesCount,
  // isUniqueGroup, peptidesList, averageAbundance, proteinGroup, score (-10lgP for Peaks).

  const adaptPeaksStudioData = (peptidesData, proteinsData) => {
    // Required headers for Peaks Studio
    const requiredPeptidesHeaders = ['Protein Accession', 'Protein Group', 'Unique', 'Peptide', 'Area IBIS_DDA_1', '-10lgP'];
    const requiredProteinsHeaders = ['Accession', 'Description'];

    const missingPeptidesHeaders = requiredPeptidesHeaders.filter(h => !peptidesData.length || !Object.keys(peptidesData[0]).includes(h));
    const missingProteinsHeaders = requiredProteinsHeaders.filter(h => !proteinsData.length || !Object.keys(proteinsData[0]).includes(h));

    if (missingPeptidesHeaders.length > 0) {
      throw new Error(`Missing required headers in Peptides File for Peaks Studio: ${missingPeptidesHeaders.join(', ')}`);
    }
    if (missingProteinsHeaders.length > 0) {
      throw new Error(`Missing required headers in Proteins File for Peaks Studio: ${missingProteinsHeaders.join(', ')}`);
    }


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
    const totalArea = mergedData.reduce((sum, item) => sum + parseFloat(item['Area IBIS_DDA_1']), 0);
    const normFactor = totalArea > 0 ? 1000000 / totalArea : 1;
    
    const normalizedData = mergedData.map(item => ({
      ...item,
      'Area IBIS_DDA_1': parseFloat(item['Area IBIS_DDA_1']) * normFactor,
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
      if (!uniqueProteinsMap.has(group) || parseFloat(item['-10lgP']) > parseFloat(uniqueProteinsMap.get(group)['-10lgP'])) {
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
      const avgArea = totalPeptides > 0 ? peptidesForVariant.reduce((sum, p) => sum + parseFloat(p['Area IBIS_DDA_1']), 0) / totalPeptides : 0;
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

    return {
      analysisResults: finalResults,
      totalPeptidesCount: peptidesData.length,
      totalProteinsCount: uniqueProteins.length,
      normalizationFactor: normFactor,
    };
  };

  const adaptMaxQuantData = (peptidesRawData, proteinsRawData) => {
    console.warn("MaxQuant data adaptation is not fully implemented. Using dummy data.");
    return {
        analysisResults: [],
        totalPeptidesCount: 0,
        totalProteinsCount: 0,
        normalizationFactor: 1,
    };
  };

  const adaptProteomeDiscovererData = (peptidesData, proteinsData) => {
    console.log("--- adaptProteomeDiscovererData ---"); // Debugging
    console.log("Peptides Data (first row):", peptidesData.length > 0 ? peptidesData[0] : "Empty or invalid"); // Debugging
    console.log("Proteins Data (first row):", proteinsData.length > 0 ? proteinsData[0] : "Empty or invalid"); // Debugging

    // Check if data is empty first
    if (peptidesData.length === 0) {
      throw new Error("Peptides File for Proteome Discoverer is empty or contains no data rows.");
    }
    if (proteinsData.length === 0) {
      throw new Error("Proteins File for Proteome Discoverer is empty or contains no data rows.");
    }

    // Helper to normalize headers for robust comparison (more aggressive)
    const normalizeHeader = (header) => header.replace(/\s/g, '').toLowerCase();

    // Function to find the exact header name in actual data, robustly
    const findExactHeader = (actualHeadersList, requiredHeaderRaw) => {
        const normalizedRequired = normalizeHeader(requiredHeaderRaw);
        console.log(`findExactHeader: Looking for normalizedRequired: "${normalizedRequired}" (Raw: "${requiredHeaderRaw}")`); // Debugging
        for (const actualHeader of actualHeadersList) {
            const normalizedActual = normalizeHeader(actualHeader);
            console.log(`findExactHeader: Comparing actualHeader: "${actualHeader}" (normalized: "${normalizedActual}")`); // Debugging
            if (normalizedActual === normalizedRequired) {
                return actualHeader; // Return the exact header string from the file
            }
        }
        return null;
    };

    const actualPeptidesHeadersList = Object.keys(peptidesData[0]);
    const actualProteinsHeadersList = Object.keys(proteinsData[0]);
    
    console.log("Actual Peptides Headers List:", actualPeptidesHeadersList); // Debugging
    console.log("Actual Proteins Headers List:", actualProteinsHeadersList); // Debugging
    console.log("Actual Peptides Headers List (Normalized):", actualPeptidesHeadersList.map(normalizeHeader)); // Debugging
    console.log("Actual Proteins Headers List (Normalized):", actualProteinsHeadersList.map(normalizeHeader)); // Debugging


    // Required headers for Proteome Discoverer (using their raw names)
    // const requiredPeptidesHeadersRaw = ['Sequence', 'Master Protein Accessions']; // Removed - Not used
    // const requiredProteinsHeadersRaw = ['Accession', 'Description', '# Peptides', '# Unique Peptides', '# Protein Groups', 'Score Sequest HT: Sequest HT']; // Removed - Not used
    const abundanceColumnRaw = 'Sum PEP Score'; // The name you identified for abundance

    // Find and validate exact header names
    const peptideSequenceHeader = findExactHeader(actualPeptidesHeadersList, 'Sequence');
    const peptideMasterAccessionsHeader = findExactHeader(actualPeptidesHeadersList, 'Master Protein Accessions');
    const proteinAccessionHeader = findExactHeader(actualProteinsHeadersList, 'Accession');
    const proteinDescriptionHeader = findExactHeader(actualProteinsHeadersList, 'Description');
    const proteinTotalPeptidesHeader = findExactHeader(actualProteinsHeadersList, '# Peptides');
    const proteinUniquePeptidesHeader = findExactHeader(actualProteinsHeadersList, '# Unique Peptides');
    const proteinGroupsHeader = findExactHeader(actualProteinsHeadersList, '# Protein Groups');
    const proteinScoreHeader = findExactHeader(actualProteinsHeadersList, 'Score Sequest HT: Sequest HT');
    const proteinAbundanceHeader = findExactHeader(actualProteinsHeadersList, abundanceColumnRaw);


    if (!peptideSequenceHeader) throw new Error(`Missing 'Sequence' header in Peptides File for Proteome Discoverer. Searched for normalized 'sequence'. Actual normalized headers: [${actualPeptidesHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!peptideMasterAccessionsHeader) throw new Error(`Missing 'Master Protein Accessions' header in Peptides File for Proteome Discoverer. Searched for normalized 'masterproteinaccessions'. Actual normalized headers: [${actualPeptidesHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!proteinAccessionHeader) throw new Error(`Missing 'Accession' header in Proteins File for Proteome Discoverer. Searched for normalized 'accession'. Actual normalized headers: [${actualProteinsHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!proteinDescriptionHeader) throw new Error(`Missing 'Description' header in Proteins File for Proteome Discoverer. Searched for normalized 'description'. Actual normalized headers: [${actualProteinsHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!proteinTotalPeptidesHeader) throw new Error(`Missing '# Peptides' header in Proteins File for Proteome Discoverer. Searched for normalized '#peptides'. Actual normalized headers: [${actualPeptidesHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!proteinUniquePeptidesHeader) throw new Error(`Missing '# Unique Peptides' header in Proteins File for Proteome Discoverer. Searched for normalized '#uniquepeptides'. Actual normalized headers: [${actualProteinsHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!proteinGroupsHeader) throw new Error(`Missing '# Protein Groups' header in Proteins File for Proteome Discoverer. Searched for normalized '#proteingroups'. Actual normalized headers: [${actualProteinsHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!proteinScoreHeader) throw new Error(`Missing 'Score Sequest HT: Sequest HT' header in Proteins File for Proteome Discoverer. Searched for normalized 'scoresequestht:sequestht'. Actual normalized headers: [${actualProteinsHeadersList.map(normalizeHeader).join(', ')}]`);
    if (!proteinAbundanceHeader) throw new Error(`Missing '${abundanceColumnRaw}' header in Proteins File for Proteome Discoverer, needed for abundance calculation. Searched for normalized 'sumpepscore'. Actual normalized headers: [${actualProteinsHeadersList.map(normalizeHeader).join(', ')}]`);


    // Step 1: Combine data - Create a map for proteins for easy lookup
    const proteinsMap = new Map();
    proteinsData.forEach(p => proteinsMap.set(p[proteinAccessionHeader], p));

    // Create a map for peptides by protein accession
    const peptidesByProteinMap = new Map();
    peptidesData.forEach(peptide => {
        // Proteome Discoverer can have multiple accessions separated by semicolon in 'Master Protein Accessions'
        const proteinAccessions = peptide[peptideMasterAccessionsHeader].split(';').map(acc => acc.trim());
        proteinAccessions.forEach(acc => {
            if (acc && proteinsMap.has(acc)) { // Only add if the protein exists in the proteinsData
                if (!peptidesByProteinMap.has(acc)) {
                    peptidesByProteinMap.set(acc, []);
                }
                peptidesByProteinMap.get(acc).push(peptide);
            }
        });
    });

    // Process each unique protein
    const uniqueProteinsProcessed = [];
    proteinsData.forEach(protein => {
      const proteinAccession = protein[proteinAccessionHeader];
      const proteinDescription = protein[proteinDescriptionHeader]; // Get description here

      const associatedPeptides = peptidesByProteinMap.get(proteinAccession) || [];

      // Total peptides from the proteins file (more reliable for total identified peptides)
      const totalPeptides = parseInt(protein[proteinTotalPeptidesHeader]) || 0;

      // Unique peptides count from the proteins file
      const uniquePeptidesCount = parseInt(protein[proteinUniquePeptidesHeader]) || 0;

      // Collect unique peptide sequences from the associated peptides, if they are considered unique to this protein
      const uniquePeptideSequences = new Set();
      if (protein[proteinGroupsHeader] === '1') { // Assuming '1' means it's a unique protein group
        associatedPeptides.forEach(p => uniquePeptideSequences.add(p[peptideSequenceHeader]));
      }
      const uniquePeptidesList = Array.from(uniquePeptideSequences).join('; ');

      // Determine if it's a unique group (based on '# Protein Groups' = 1)
      const isUniqueGroup = protein[proteinGroupsHeader] === '1';

      // Get abundance from 'Sum PEP Score'
      const averageAbundance = parseFloat(protein[proteinAbundanceHeader]) || 0;
      
      // Protein Score (e.g., Sequest HT score for internal selection if needed)
      const proteinScore = parseFloat(protein[proteinScoreHeader]) || 0;

      // Filter for pathogenic variants - REVISED LOGIC
      // Check for pathogenic pattern in Accession AND specific keywords in Description
      const isPathogenicByAccession = pathogenicPattern.test(proteinAccession);
      const isPathogenicByDescription = proteinDescription && (
          proteinDescription.includes('PATHOGENIC_VARIANT') ||
          proteinDescription.includes('ClinicalSignificance:')
      );

      // --- ULTRA-SPECIFIC DEBUGGING LOGS ---
      console.log(`Processing Protein: ${proteinAccession}`);
      console.log(`  Description: "${proteinDescription}" (Hex: ${Array.from(proteinDescription || '').map(c => c.charCodeAt(0).toString(16)).join(' ')})`);
      console.log(`  isPathogenicByAccession: ${isPathogenicByAccession}`);
      console.log(`  isPathogenicByDescription: ${isPathogenicByDescription}`);
      console.log(`  Combined Filter Result: ${isPathogenicByAccession && isPathogenicByDescription}`);
      // --- END DEBUGGING LOGS ---


      if (isPathogenicByAccession && isPathogenicByDescription) {
            uniqueProteinsProcessed.push({
                'Protein Accession': proteinAccession,
                'Description': proteinDescription,
                'Average Abundance': averageAbundance,
                '# Total Peptides': totalPeptides,
                '# Unique Peptides': uniquePeptidesCount,
                '# Proteins in Group': parseInt(protein[proteinGroupsHeader]) || 0,
                'Is Unique Group?': isUniqueGroup,
                'Unique Peptides List': uniquePeptidesList,
                'Protein Score Sequest HT': proteinScore
            });
        }
    });

    const finalResults = uniqueProteinsProcessed.sort((a, b) => b['Average Abundance'] - a['Average Abundanc e']);

    return {
      analysisResults: finalResults,
      totalPeptidesCount: peptidesData.length,
      totalProteinsCount: proteinsData.length,
      normalizationFactor: 1,
    };
  };

  const adaptSpectronautData = (dataRaw) => {
    console.warn("Spectronaut data adaptation is not fully implemented. Using dummy data.");
    return {
        analysisResults: [],
        totalPeptidesCount: 0,
        totalProteinsCount: 0,
        normalizationFactor: 1,
    };
  };

  const adaptDiannData = (dataRaw) => {
    console.warn("DIA-NN data adaptation is not fully implemented. Using dummy data.");
    return {
        analysisResults: [],
        totalPeptidesCount: 0,
        totalProteinsCount: 0,
        normalizationFactor: 1,
    };
  };

  const processAllSamples = async () => {
    setLoading(true);
    setError(null);
    const newProcessedSamples = [];
    let hasError = false;

    for (const sampleInput of sampleInputs) {
      if (!sampleInput.name || sampleInput.name.trim() === '') {
        setError(`Error: Sample in slot ${sampleInput.id} does not have a valid name.`);
        hasError = true;
        break;
      }
      
      let processedSampleData;
      try {
        switch (sampleInput.sourceSoftware) {
          case 'Peaks Studio':
            if (!sampleInput.files.peptides || !sampleInput.files.proteins) {
              setError(`Error: Sample "${sampleInput.name}" (Peaks Studio) requires both 'Peptides File' and 'Proteins File'.`);
              hasError = true;
              break;
            }
            const peaksPeptidesData = await parseCSV(sampleInput.files.peptides);
            const peaksProteinsData = await parseCSV(sampleInput.files.proteins);
            processedSampleData = adaptPeaksStudioData(peaksPeptidesData, peaksProteinsData);
            break;
          case 'MaxQuant':
            if (!sampleInput.files.peptides || !sampleInput.files.proteins) {
                setError(`Error: Sample "${sampleInput.name}" (MaxQuant) requires both 'Peptides File' and 'Proteins File'.`);
                hasError = true;
                break;
            }
            const mqPeptidesData = await parseCSV(sampleInput.files.peptides);
            const mqProteinsData = await parseCSV(sampleInput.files.proteins);
            processedSampleData = adaptMaxQuantData(mqPeptidesData, mqProteinsData);
            break;
          case 'Proteome Discoverer':
            if (!sampleInput.files.peptides || !sampleInput.files.proteins) {
                setError(`Error: Sample "${sampleInput.name}" (Proteome Discoverer) requires both 'Peptides File' and 'Proteins File'.`);
                hasError = true;
                break;
            }
            const pdPeptidesData = await parseCSV(sampleInput.files.peptides);
            const pdProteinsData = await parseCSV(sampleInput.files.proteins);
            processedSampleData = adaptProteomeDiscovererData(pdPeptidesData, pdProteinsData);
            break;
          case 'Spectronaut':
            if (!sampleInput.files.peptides) {
                setError(`Error: Sample "${sampleInput.name}" (Spectronaut) requires a 'Peptides File'.`);
                hasError = true;
                break;
            }
            const spectronautData = await parseCSV(sampleInput.files.peptides);
            processedSampleData = adaptSpectronautData(spectronautData);
            break;
          case 'DIA-NN':
            if (!sampleInput.files.peptides) {
                setError(`Error: Sample "${sampleInput.name}" (DIA-NN) requires a 'Peptides File'.`);
                hasError = true;
                break;
            }
            const diannData = await parseCSV(sampleInput.files.peptides);
            processedSampleData = adaptDiannData(diannData);
            break;
          default:
            setError(`Error: Unknown software type for sample "${sampleInput.name}".`);
            hasError = true;
            break;
        }

        if (hasError) break;

        newProcessedSamples.push({
          id: sampleInput.id,
          name: sampleInput.name.trim(),
          analysisResults: processedSampleData.analysisResults,
          totalPeptidesCount: processedSampleData.totalPeptidesCount,
          totalProteinsCount: processedSampleData.totalProteinsCount,
          normalizationFactor: processedSampleData.normalizationFactor,
        });

      } catch (err) {
        console.error(`Error processing sample ${sampleInput.name}:`, err);
        setError(`An error occurred while processing sample "${sampleInput.name}". Please ensure files are valid CSVs and contain expected columns for ${sampleInput.sourceSoftware}. Specific error: ${err.message}`);
        hasError = true;
        break;
      }
    }

    if (!hasError) {
      setProcessedSamples(newProcessedSamples);
      setSelectedProcessedSampleIds(newProcessedSamples.map(s => s.id));
      if (newProcessedSamples.length > 0) {
        setError(null);
      } else {
        setError("No samples could be processed. Ensure all files are loaded and names are correct.");
      }
    }
    setLoading(false);
  };

  // Function to validate the form before enabling the "Process All Samples" button
  const isFormValid = () => {
    for (const sample of sampleInputs) {
      if (!sample.name || sample.name.trim() === '') {
        console.warn(`Validation: Sample ${sample.id} has no name or only whitespace.`);
        return false;
      }
      if (!sample.files.peptides) {
        console.warn(`Validation: Sample ${sample.id} is missing a peptides file.`);
        return false;
      }
      // Only require proteins file for specific software types
      if (
        (sample.sourceSoftware === 'Peaks Studio' ||
         sample.sourceSoftware === 'MaxQuant' ||
         sample.sourceSoftware === 'Proteome Discoverer') &&
        !sample.files.proteins
      ) {
        console.warn(`Validation: Sample ${sample.id} (${sample.sourceSoftware}) is missing a proteins file.`);
        return false;
      }
    }
    console.log("Validation: All samples are valid.");
    return true;
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
    if (abundance === 0) return 'rgba(240, 240, 240, 1)';
    const hue = 210;
    const saturation = 80;
    const maxLightness = 95;
    const minLightness = 30;

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
    csvRows.push(comparativeHeaders.join(','));

    comparativeTableRows.forEach(row => {
      const formattedRow = row.map(cell => {
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
              {/* New: Source Software Selector */}
              <div className="mb-4">
                <label htmlFor={`sourceSoftware-${sampleSlot.id}`} className="block text-sm font-medium text-gray-700 mb-1">Source Software:</label>
                <select
                  id={`sourceSoftware-${sampleSlot.id}`}
                  value={sampleSlot.sourceSoftware}
                  onChange={(e) => handleSourceSoftwareChange(sampleSlot.id, e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="Peaks Studio">Peaks Studio</option>
                  <option value="MaxQuant">MaxQuant</option>
                  <option value="Proteome Discoverer">Proteome Discoverer</option>
                  <option value="Spectronaut">Spectronaut</option>
                  <option value="DIA-NN">DIA-NN</option>
                </select>
              </div>
              <div className="space-y-3">
                {/* File inputs dynamically shown based on software */}
                <div className="p-2 bg-gray-50 rounded-xl border border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {sampleSlot.sourceSoftware === 'Spectronaut' || sampleSlot.sourceSoftware === 'DIA-NN' ? 
                      'Data File (e.g., PeptideGroups.tsv / proteins.tsv)' : 
                      'Peptides File (e.g., protein-peptides.csv / PeptideGroups.txt)'}
                  </label>
                  <input 
                    type="file" 
                    accept=".csv,.txt,.tsv"
                    onChange={(e) => handleSampleFileChange(sampleSlot.id, 'peptides', e.target.files[0])} 
                    className="w-full text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
                  />
                </div>
                {/* Proteins file is generally needed for Peaks, MaxQuant, PD. Spectronaut/DIA-NN often consolidate. */}
                {(sampleSlot.sourceSoftware === 'Peaks Studio' || sampleSlot.sourceSoftware === 'MaxQuant' || sampleSlot.sourceSoftware === 'Proteome Discoverer') && (
                  <div className="p-2 bg-gray-50 rounded-xl border border-gray-100">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Proteins File (e.g., `proteins.csv` / `Proteins.txt`)</label>
                    <input 
                      type="file" 
                      accept=".csv,.txt,.tsv"
                      onChange={(e) => handleSampleFileChange(sampleSlot.id, 'proteins', e.target.files[0])} 
                      className="w-full text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
                    />
                  </div>
                )}
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
            // Disable if loading, or any sample slot has no name, or is missing required files for its selected software
            disabled={loading || !isFormValid()}
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
        {(processedSamples.length > 0) && (
          <div className="mt-8 p-6 bg-gray-50 rounded-3xl shadow-inner">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Visualizaciones</h2>

            {/* Comparative Bar Chart */}
            <h3 className="text-xl font-bold text-gray-700 mb-4">Gráfico de Barras Comparativo (Selecciona una Proteína)</h3>
            <div className="mb-4">
              <label htmlFor="proteinForChart" className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Acceso de Proteína:</label>
              <select
                id="proteinForChart"
                value={selectedProteinForChart}
                onChange={(e) => setSelectedProteinForChart(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                disabled={!allUniqueProteins || allUniqueProteins.length === 0}
              >
                <option value="">-- Selecciona una Proteína --</option>
                {allUniqueProteins.map(accession => (
                  <option key={accession} value={accession}>{accession}</option>
                ))}
              </select>
            </div>
            {selectedProteinForChart && isChartLibraryLoaded ? (
              <div className="mb-8 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm" style={{ height: '400px', width: '100%' }}>
                <canvas ref={comparativeChartCanvasRef}></canvas>
              </div>
            ) : (
                <div className="mb-8 p-4 text-gray-600 bg-gray-100 rounded-2xl border border-gray-200">
                    <p className="font-semibold">Selecciona una proteína del menú desplegable de arriba para ver su abundancia comparativa entre muestras.</p>
                </div>
            )}
            {!isChartLibraryLoaded && (
                <div className="mt-4 p-4 text-gray-700 bg-gray-100 rounded-2xl border border-gray-200">
                    <p className="font-semibold">Cargando la librería de gráficos... Por favor, espera a que aparezcan las visualizaciones.</p>
                </div>
            )}


            {/* Heatmap */}
            <h3 className="text-xl font-bold text-gray-700 mb-4 mt-8">Mapa de Calor de Abundancia Comparativa</h3>
            <div className="overflow-x-auto p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
                {visualizationData.length > 0 && samplesForComparison.length > 0 ? (
                    <div className="inline-block min-w-full">
                        {/* Heatmap Header (Sample Names) */}
                        <div className="flex flex-row sticky top-0 bg-white z-10 border-b border-gray-200">
                            <div className="flex-shrink-0" style={{ width: '200px', padding: '8px', fontWeight: 'bold' }}>Acceso de Proteína</div>
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
                                            borderRight: '1% solid #e5e7eb'
                                        }}
                                        title={`Abundancia: ${proteinRow.abundancesBySample[sample.name].toFixed(2)}`}
                                    >
                                        {proteinRow.abundancesBySample[sample.name] > 0 ? proteinRow.abundancesBySample[sample.name].toFixed(0) : 'N/A'}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-4 text-gray-600 bg-gray-100 rounded-2xl border border-gray-200">
                        <p className="font-semibold">No hay datos disponibles para el mapa de calor. Procesa las muestras y selecciónalas para comparar.</p>
                    </div>
                )}
            </div>

            {/* Venn Diagram Section */}
            <h3 className="text-xl font-bold text-gray-700 mb-4 mt-8">Análisis por Diagramas de Venn</h3>
            <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Selecciona 2 o 3 muestras para el Diagrama de Venn:</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {processedSamples.map(sample => (
                    <label key={sample.id} className="inline-flex items-center p-2 bg-white rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:bg-gray-100 transition-colors">
                    <input
                        type="checkbox"
                        checked={selectedVennSampleIds.includes(sample.id)}
                        onChange={() => handleSelectVennSample(sample.id)}
                        className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                        disabled={!selectedVennSampleIds.includes(sample.id) && selectedVennSampleIds.length >= 3}
                    />
                    <span className="ml-2 text-gray-700 font-medium">{sample.name}</span>
                    </label>
                ))}
                </div>
            </div>
            {selectedVennSampleIds.length >= 2 && selectedVennSampleIds.length <= 3 && isD3Loaded && isD3VennLoaded && window.d3 && window.venn ? (
                <div className="mb-8 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm flex justify-center items-center" style={{ height: '450px', width: '100%' }}>
                    <div ref={vennDiagramRef} className="venn-container"></div>
                </div>
            ) : (
                <div className="mb-8 p-4 text-gray-600 bg-gray-100 rounded-2xl border border-gray-200">
                    <p className="font-semibold">Por favor, selecciona entre 2 y 3 muestras procesadas para generar el Diagrama de Venn.</p>
                </div>
            )}
            {processedSamples.length > 0 && (!isD3Loaded || !isD3VennLoaded) && (
                <div className="mt-4 p-4 text-gray-700 bg-gray-100 rounded-2xl border border-gray-200">
                    <p className="font-semibold">Cargando librerías necesarias para el Diagrama de Venn (D3 y D3-Venn)... Por favor, espera.</p>
                </div>
            )}

          </div>
        )}
        {!processedSamples.length > 0 && (
            <div className="mt-8 p-4 text-gray-700 bg-gray-100 rounded-2xl border border-gray-200">
                <p className="font-semibold">Procesa al menos dos muestras para generar visualizaciones y la tabla comparativa.</p>
            </div>
        )}

        {/* Comparative Table Section */}
        {comparativeTableRows.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Tabla de Abundancia Comparativa</h2>
            <p className="text-gray-600 mb-4 text-sm italic">
                Abundancias normalizadas para las muestras seleccionadas.
            </p>
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 mb-4">
              <button
                onClick={exportComparativeToCsv}
                disabled={isExporting || comparativeTableRows.length === 0}
                className="w-full py-3 px-6 bg-green-600 text-white font-bold rounded-2xl shadow-md hover:bg-green-700 transition-colors disabled:bg-green-300 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                <span>{isExporting ? "Exportando..." : "Exportar Tabla Comparativa a Excel (CSV)"}</span>
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

        {/* Custom Tooltip for Venn Diagram */}
        {tooltip && (
            <div
                style={{
                    position: 'absolute',
                    left: tooltip.x,
                    top: tooltip.y,
                    pointerEvents: 'none', // Allow events to pass through to underlying elements
                    zIndex: 1000,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    maxWidth: '300px',
                    lineHeight: '1.4',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    backdropFilter: 'blur(5px)',
                    WebkitBackdropFilter: 'blur(5px)'
                }}
                dangerouslySetInnerHTML={{ __html: tooltip.content }}
            />
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
