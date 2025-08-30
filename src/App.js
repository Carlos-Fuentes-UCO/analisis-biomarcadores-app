import React, { useState, useEffect, useRef } from 'react';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, collection, query, where } from 'firebase/firestore';

// Define regular expressions patterns for pathogenic variants
const pathogenicPattern = /(-VAR_)|(-[A-Z]\d+[A-Z])/;

/**
 * @typedef {object} ProteinData - Formato de Datos Unificado (FDU) para una proteína.
 * @property {string} accession - ID de acceso principal de la proteína (ej: "P12345").
 * @property {string} description - Descripción completa de la proteína (ej: "Vimentin OS=Homo sapiens...").
 * @property {string} diseaseAssociation - Asociación de enfermedad o significado clínico (ej: "Cáncer", "N/A").
 * @property {number} averageAbundance - Abundancia promedio normalizada.
 * @property {number} totalPeptides - Número total de péptidos identificados para esta proteína.
 * @property {number} uniquePeptidesCount - Número de péptidos únicos.
 * @property {boolean} isUniqueGroup - Indica si es un grupo de proteínas único (true/false).
 * @property {string} uniquePeptidesList - Lista de secuencias de péptidos únicos (separados por ';').
 * @property {number} [rawScore] - Puntuación bruta del software de origen (opcional, ej: -10lgP de Peaks).
 */

const App = () => {
    // State to manage multiple file input sets
    const [sampleInputs, setSampleInputs] = useState([{ id: 1, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
    const [proteinsData, setProteinsData] = useState([]);
    const [commonProteins, setCommonProteins] = useState([]);
    const [vennData, setVennData] = useState({ sets: [], overlaps: [] });
    const [showTables, setShowTables] = useState(false);
    const [tooltip, setTooltip] = useState(null);
    const [copyMessage, setCopyMessage] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
    const auth = getAuth();

    useEffect(() => {
        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const auth = getAuth(app);
        setDb(firestore);

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                try {
                    if (typeof __initial_auth_token !== 'undefined') {
                        await signInWithCustomToken(auth, __initial_auth_token);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (error) {
                    console.error("Firebase Auth Error:", error);
                }
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!userId || !db) return;

        // Fetch data from Firestore for real-time updates
        const q = query(collection(db, `artifacts/${appId}/users/${userId}/proteinData`));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const fetchedData = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                fetchedData.push(data);
            });
            // Update state with fetched data
            console.log("Datos de Firestore actualizados:", fetchedData);
        }, (error) => {
            console.error("Error al obtener datos de Firestore:", error);
        });

        return () => unsubscribe();
    }, [userId, db, appId]);

    const handleFileChange = (e, sampleId, fileType) => {
        const file = e.target.files[0];
        if (file) {
            setSampleInputs(prevInputs =>
                prevInputs.map(input =>
                    input.id === sampleId
                        ? { ...input, files: { ...input.files, [fileType]: file } }
                        : input
                )
            );
        }
    };

    const handleInputChange = (e, sampleId, field) => {
        const value = e.target.value;
        setSampleInputs(prevInputs =>
            prevInputs.map(input =>
                input.id === sampleId
                    ? { ...input, [field]: value }
                    : input
            )
        );
    };

    const addSampleInput = () => {
        const newId = sampleInputs.length > 0 ? Math.max(...sampleInputs.map(s => s.id)) + 1 : 1;
        setSampleInputs(prevInputs => [...prevInputs, { id: newId, name: '', sourceSoftware: 'Peaks Studio', files: { peptides: null, proteins: null } }]);
    };

    const removeSampleInput = (id) => {
        setSampleInputs(prevInputs => prevInputs.filter(input => input.id !== id));
    };

    const processFiles = async () => {
        const allProteins = {};
        const allProteinGroups = {};
        const allPeptideSets = {};
        const proteinAccessions = new Set();
        let uniqueGroupCounter = 0;
        let proteinIdCounter = 0;

        for (const input of sampleInputs) {
            if (!input.files.proteins || !input.files.peptides) continue;

            // Process proteins file
            const proteinsText = await input.files.proteins.text();
            const proteinsLines = proteinsText.split('\n').slice(1).filter(l => l.trim());
            const parsedProteins = {};
            const proteinAccsInFile = new Set();
            proteinsLines.forEach(line => {
                const parts = line.split('\t');
                const accession = parts[2].split('|').pop().replace(/"/g, '');
                const rawScore = parseFloat(parts[3]);
                const description = parts[parts.length - 1].replace(/"/g, '').trim();

                const isPathogenic = pathogenicPattern.test(description) || description.toLowerCase().includes('pathogenic');
                const diseaseAssociation = isPathogenic ? "Pathogenic" : "N/A";
                const avgAbundance = parseFloat(parts[parts.length - 5]);
                const totalPeptides = parseInt(parts[parts.length - 4]);
                const uniquePeptidesCount = parseInt(parts[parts.length - 3]);
                const proteinGroup = parseInt(parts[0]);

                if (!parsedProteins[accession]) {
                    parsedProteins[accession] = {
                        accession,
                        description,
                        diseaseAssociation,
                        averageAbundance: avgAbundance,
                        totalPeptides,
                        uniquePeptidesCount,
                        uniquePeptidesList: '',
                        rawScore: rawScore,
                        isUniqueGroup: false,
                        proteinGroup
                    };
                }
                proteinAccsInFile.add(accession);
                proteinAccessions.add(accession);
            });
            allProteinGroups[input.id] = proteinAccsInFile;
            allProteins[input.id] = parsedProteins;

            // Process peptides file
            const peptidesText = await input.files.peptides.text();
            const peptidesLines = peptidesText.split('\n').slice(1).filter(l => l.trim());
            const peptideSet = new Set();
            peptidesLines.forEach(line => {
                const parts = line.split('\t');
                if (parts[4] === 'Y') {
                    peptideSet.add(parts[3]);
                }
            });
            allPeptideSets[input.id] = peptideSet;
        }

        const proteinDataArray = [];
        const uniqueProteinGroups = {};
        const overlaps = {};

        for (const input of sampleInputs) {
            if (!allProteins[input.id]) continue;
            for (const acc in allProteins[input.id]) {
                const protein = allProteins[input.id][acc];
                const peptideList = Array.from(allPeptideSets[input.id]).join(';');
                proteinDataArray.push({
                    ...protein,
                    uniquePeptidesList: peptideList,
                    sampleId: input.id,
                    sampleName: input.name,
                    sourceSoftware: input.sourceSoftware,
                    isUniqueGroup: false
                });

                // Determine unique protein groups for Venn Diagram
                if (!uniqueProteinGroups[acc]) {
                    uniqueProteinGroups[acc] = new Set();
                }
                uniqueProteinGroups[acc].add(input.id);
            }
        }

        const vennSets = sampleInputs.map(input => ({
            id: input.id.toString(),
            label: input.name || `Muestra ${input.id}`,
            size: allProteinGroups[input.id].size
        }));

        // Calculate overlaps
        const allGroups = sampleInputs.map(input => input.id);
        const combinations = getCombinations(allGroups);

        for (const combo of combinations) {
            let intersection = new Set(allProteinGroups[combo[0]]);
            for (let i = 1; i < combo.length; i++) {
                intersection = new Set([...intersection].filter(x => allProteinGroups[combo[i]].has(x)));
            }
            if (intersection.size > 0) {
                const key = combo.join('-');
                overlaps[key] = intersection;
            }
        }

        const vennOverlaps = Object.entries(overlaps).map(([key, value]) => ({
            sets: key.split('-').map(id => id.toString()),
            size: value.size
        }));

        setVennData({ sets: vennSets, overlaps: vennOverlaps });

        // Identify common proteins
        let commonAccessions = new Set();
        if (sampleInputs.length > 1) {
            commonAccessions = new Set(allProteinGroups[sampleInputs[0].id]);
            for (let i = 1; i < sampleInputs.length; i++) {
                commonAccessions = new Set([...commonAccessions].filter(x => allProteinGroups[sampleInputs[i].id].has(x)));
            }
        }
        const commonProteinsData = proteinDataArray.filter(p => commonAccessions.has(p.accession));
        setCommonProteins(commonProteinsData);
        setProteinsData(proteinDataArray);
        setShowTables(true);

        // Store data in Firestore
        if (db && userId) {
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/proteinData/analysis`);
            await setDoc(docRef, {
                timestamp: new Date().toISOString(),
                vennData: JSON.stringify(vennData),
                commonProteins: JSON.stringify(commonProteinsData),
                allProteins: JSON.stringify(proteinDataArray)
            });
            console.log("Datos guardados en Firestore.");
        }
    };

    const getCombinations = (arr) => {
        const result = [];
        for (let i = 2; i <= arr.length; i++) {
            const sub = getCombinationsK(arr, i);
            result.push(...sub);
        }
        return result;
    };

    const getCombinationsK = (arr, k) => {
        const result = [];
        const f = (prefix, remaining) => {
            if (prefix.length === k) {
                result.push(prefix);
                return;
            }
            for (let i = 0; i < remaining.length; i++) {
                f(prefix.concat(remaining[i]), remaining.slice(i + 1));
            }
        };
        f([], arr);
        return result;
    };

    const copyToClipboard = (text) => {
        const tempTextArea = document.createElement("textarea");
        tempTextArea.value = text;
        document.body.appendChild(tempTextArea);
        tempTextArea.select();
        try {
            document.execCommand('copy');
            setCopyMessage({ message: 'Texto copiado al portapapeles.', isError: false });
        } catch (err) {
            console.error('Error al copiar el texto: ', err);
            setCopyMessage({ message: 'Error al copiar el texto.', isError: true });
        }
        document.body.removeChild(tempTextArea);
        setTimeout(() => setCopyMessage(null), 3000);
    };

    const getUniqueProteins = (sampleId) => {
        const uniqueSet = new Set(proteinsData.filter(p => p.sampleId === sampleId).map(p => p.accession));
        const otherSamples = proteinsData.filter(p => p.sampleId !== sampleId);
        otherSamples.forEach(p => uniqueSet.delete(p.accession));
        return proteinsData.filter(p => uniqueSet.has(p.accession) && p.sampleId === sampleId);
    };

    const formatVennLabels = (data) => {
        if (!data || !data.sets) return [];
        return data.sets.map(set => ({ label: set.label, size: set.size }));
    };

    const getVennTooltipContent = (data, point) => {
        if (!data || !point) return '';
        if (point.sets) {
            const intersectingAccessions = vennData.overlaps[point.sets.join('-')];
            if (intersectingAccessions) {
                const labels = point.sets.map(setId => vennData.sets.find(s => s.id === setId)?.label).join(' y ');
                const proteinsList = Array.from(intersectingAccessions).map(acc => {
                    const protein = proteinsData.find(p => p.accession === acc);
                    return `<span class="font-semibold">${acc}</span>: ${protein?.description.split(' OS=')[0] || 'N/A'}`;
                }).join('<br/>');
                return `<span class="font-bold text-lg">${labels}</span><br/><br/>Proteínas (${intersectingAccessions.size}):<br/>${proteinsList}`;
            }
        }
        if (point.label) {
            const uniqueProteins = getUniqueProteins(parseInt(point.id));
            const proteinsList = uniqueProteins.map(p => {
                return `<span class="font-semibold">${p.accession}</span>: ${p.description.split(' OS=')[0] || 'N/A'}`;
            }).join('<br/>');
            return `<span class="font-bold text-lg">${point.label}</span><br/><br/>Proteínas Únicas (${point.size}):<br/>${proteinsList}`;
        }
        return '';
    };
    
    // Function to handle showing the tooltip
    const handleMouseEnter = (event, data, point) => {
        const content = getVennTooltipContent(data, point);
        setTooltip({
            x: event.pageX,
            y: event.pageY,
            content: content
        });
    };
    
    // Function to handle hiding the tooltip
    const handleMouseLeave = () => {
        setTooltip(null);
    };

    return (
        <div className="min-h-screen bg-gray-100 p-8 font-sans antialiased text-gray-800">
            <h1 className="text-4xl font-bold text-center text-blue-800 mb-8">Análisis de Datos Proteómicos</h1>
            <p className="text-center text-lg text-gray-600 mb-10 max-w-2xl mx-auto">
                Una herramienta interactiva para analizar y comparar conjuntos de datos proteómicos de diferentes fuentes. 
                <span className="block mt-2 font-semibold text-blue-700">Comienza subiendo tus archivos de péptidos y proteínas.</span>
            </p>

            <div className="bg-white p-8 rounded-2xl shadow-xl space-y-8 max-w-4xl mx-auto">
                {sampleInputs.map(input => (
                    <div key={input.id} className="border-b pb-6 border-gray-200 last:border-b-0">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-semibold text-gray-700">Muestra {input.id}</h2>
                            {sampleInputs.length > 1 && (
                                <button
                                    onClick={() => removeSampleInput(input.id)}
                                    className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors duration-200"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre de la Muestra</label>
                                <input
                                    type="text"
                                    value={input.name}
                                    onChange={(e) => handleInputChange(e, input.id, 'name')}
                                    placeholder={`Ej: Muestra ${input.id}`}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Software de Origen</label>
                                <select
                                    value={input.sourceSoftware}
                                    onChange={(e) => handleInputChange(e, input.id, 'sourceSoftware')}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="Peaks Studio">Peaks Studio</option>
                                    <option value="MaxQuant">MaxQuant</option>
                                    <option value="Proteome Discoverer">Proteome Discoverer</option>
                                </select>
                            </div>
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Archivo de Péptidos</label>
                                <input
                                    type="file"
                                    accept=".txt, .csv"
                                    onChange={(e) => handleFileChange(e, input.id, 'peptides')}
                                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                />
                                {input.files.peptides && <p className="mt-2 text-xs text-gray-500 truncate">Archivo: {input.files.peptides.name}</p>}
                            </div>
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Archivo de Proteínas</label>
                                <input
                                    type="file"
                                    accept=".txt, .csv"
                                    onChange={(e) => handleFileChange(e, input.id, 'proteins')}
                                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                />
                                {input.files.proteins && <p className="mt-2 text-xs text-gray-500 truncate">Archivo: {input.files.proteins.name}</p>}
                            </div>
                        </div>
                    </div>
                ))}

                <div className="flex justify-center space-x-4">
                    <button
                        onClick={addSampleInput}
                        className="py-2 px-6 bg-green-500 text-white font-semibold rounded-full shadow-lg hover:bg-green-600 transition-transform duration-200 transform hover:scale-105"
                    >
                        + Agregar Muestra
                    </button>
                    <button
                        onClick={processFiles}
                        className="py-2 px-6 bg-blue-600 text-white font-semibold rounded-full shadow-lg hover:bg-blue-700 transition-transform duration-200 transform hover:scale-105"
                    >
                        Analizar Datos
                    </button>
                </div>
            </div>

            {showTables && (
                <div className="mt-12 space-y-12">
                    {/* Sección de Resumen y Diagrama de Venn */}
                    <div className="bg-white p-8 rounded-2xl shadow-xl">
                        <h2 className="text-3xl font-bold text-center text-blue-800 mb-6">Resumen del Análisis</h2>
                        <div className="flex flex-col lg:flex-row items-center justify-center space-y-8 lg:space-y-0 lg:space-x-12">
                            {/* Visualización del Diagrama de Venn (placeholder) */}
                            <div className="relative w-full lg:w-1/2 flex items-center justify-center">
                                <svg width="400" height="400" viewBox="0 0 400 400">
                                    <text x="200" y="200" textAnchor="middle" className="text-lg font-semibold fill-gray-500">
                                        Diagrama de Venn (Provisorio)
                                    </text>
                                    <circle cx="150" cy="150" r="100" fill="red" opacity="0.3" 
                                        onMouseEnter={(e) => handleMouseEnter(e, vennData, vennData.sets[0])}
                                        onMouseLeave={handleMouseLeave} />
                                    <circle cx="250" cy="150" r="100" fill="blue" opacity="0.3" 
                                        onMouseEnter={(e) => handleMouseEnter(e, vennData, vennData.sets[1])}
                                        onMouseLeave={handleMouseLeave} />
                                    <circle cx="200" cy="250" r="100" fill="green" opacity="0.3" 
                                        onMouseEnter={(e) => handleMouseEnter(e, vennData, vennData.sets[2])}
                                        onMouseLeave={handleMouseLeave} />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Tabla de Proteínas Comunes */}
                    <div className="bg-white p-8 rounded-2xl shadow-xl overflow-x-auto">
                        <h3 className="text-2xl font-bold text-blue-700 mb-4">Proteínas Comunes a todas las muestras</h3>
                        <table className="min-w-full divide-y divide-gray-200 rounded-lg overflow-hidden">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Acceso
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Descripción
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Asociación
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Péptidos Únicos
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <div className="flex items-center">
                                            <span>Copiar</span>
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 ml-1">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25L12 21m0 0l-3.75-3.75M12 21V3" />
                                            </svg>
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {commonProteins.map((protein, index) => (
                                    <tr key={index} className="hover:bg-gray-100 transition-colors duration-200">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{protein.accession}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{protein.description}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{protein.diseaseAssociation}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{protein.uniquePeptidesCount}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => copyToClipboard(protein.uniquePeptidesList)}
                                                className="text-blue-600 hover:text-blue-900 transition-colors duration-200"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25L12 21m0 0l-3.75-3.75M12 21V3" />
                                                </svg>
                                            </button>
                                        </td>
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
    );
};

export default App;
