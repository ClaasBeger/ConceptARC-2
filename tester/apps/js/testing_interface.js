
// Internal state.
var CURRENT_INPUT_GRID = new Grid(3, 3);
var CURRENT_OUTPUT_GRID = new Grid(3, 3);
var TEST_PAIRS = new Array();
var CURRENT_TEST_PAIR_INDEX = 0;
var COPY_PASTE_DATA = new Array();
var CURRENT_TASK_NAME = null; // Store original task name
var SUBMISSION_DATA = []; // Store all submissions
var CORPUS2_TASK_LIST = null; // Cache list of corpus-2 tasks
var TRIAL_DATA = null; // Store trial definitions
var CURRENT_TRIAL = null; // Current trial being worked on
var CURRENT_TRIAL_INDEX = 0; // Current index in trial (0-29)

// Cosmetic.
var EDITION_GRID_HEIGHT = 500;
var EDITION_GRID_WIDTH = 500;
var MAX_CELL_SIZE = 100;

// Hash function for task names (simple hash to avoid collisions for ~160 tasks)
function hashTaskName(taskName) {
    var hash = 0;
    if (taskName.length === 0) return hash.toString();
    for (var i = 0; i < taskName.length; i++) {
        var char = taskName.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}

// Initialize submission JSON file
function initializeSubmissionFile() {
    SUBMISSION_DATA = [];
    // The file will be created/downloaded when first submission is made
}

// Save submission data to JSON file (accumulates all submissions)
var SUBMISSION_FILE_NAME = 'submissions_' + new Date().toISOString().replace(/:/g, '-').split('.')[0] + '.json';

function saveSubmissionData(trialNumber) {
    var dataToSave;
    if (trialNumber !== undefined && trialNumber !== null) {
        // Include trial ID at top level
        dataToSave = {
            trial_id: trialNumber,
            submissions: SUBMISSION_DATA
        };
    } else {
        // No trial number, just save submissions array
        dataToSave = SUBMISSION_DATA;
    }
    var dataStr = JSON.stringify(dataToSave, null, 2);
    var dataBlob = new Blob([dataStr], {type: 'application/json'});
    var url = URL.createObjectURL(dataBlob);
    var link = document.createElement('a');
    link.href = url;
    link.download = SUBMISSION_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Get list of corpus-2 tasks
function getCorpus2TaskList() {
    if (CORPUS2_TASK_LIST) {
        return Promise.resolve(CORPUS2_TASK_LIST);
    }
    
    // List of corpus-2 task files
    // Since we can't easily list files in a directory from JavaScript in a browser,
    // we create a static list based on the directory structure
    var taskList = [];
    var categories = [
        {name: 'AboveBelow_v2', base: 'AboveBelow', count: 10},
        {name: 'Center_v2', base: 'Center', count: 10},
        {name: 'Cleanup_v2', base: 'CleanUp', count: 10},
        {name: 'CompleteShape_v2', base: 'CompleteShape', count: 10, special: {1: 'completeShape1.json'}},
        {name: 'Copy_v2', base: 'Copy', count: 10},
        {name: 'Count_v2', base: 'Count', count: 10},
        {name: 'ExtendToBoundary_v2', base: 'ExtendToBoundary', count: 10},
        {name: 'ExtractObjects_v2', base: 'ExtractObjects', count: 10},
        {name: 'FilledNotFilled_v2', base: 'FilledNotFilled', count: 10},
        {name: 'HorizontalVertical_v2', base: 'HorizontalVertical', count: 10},
        {name: 'InsideOutside_v2', base: 'InsideOutside', count: 10},
        {name: 'MoveToBoundary_v2', base: 'MoveToBoundary', count: 10},
        {name: 'Order_v2', base: 'Order', count: 10},
        {name: 'SameDifferent_v2', base: 'SameDifferent', count: 10},
        {name: 'TopBottom2D_v2', base: 'TopBottom2D', count: 10},
        {name: 'TopBottom3D_v2', base: 'TopBottom3D', count: 10}
    ];
    
    categories.forEach(function(category) {
        for (var i = 1; i <= category.count; i++) {
            var taskName;
            if (category.special && category.special[i]) {
                taskName = category.special[i];
            } else {
                taskName = category.base + i + '.json';
            }
            taskList.push({
                category: category.name,
                name: taskName,
                path: '../corpus-2/' + category.name + '/' + taskName
            });
        }
    });
    
    CORPUS2_TASK_LIST = taskList;
    return Promise.resolve(taskList);
}

// Load trials from static JSON file or embedded JavaScript
function loadTrialsFromFile() {
    if (TRIAL_DATA) {
        return Promise.resolve(TRIAL_DATA);
    }
    
    // First try to use embedded data (works with file:// protocol)
    if (typeof TRIALS_DATA !== 'undefined' && TRIALS_DATA) {
        console.log('Using embedded trials data');
        TRIAL_DATA = TRIALS_DATA;
        return Promise.resolve(TRIALS_DATA);
    }
    
    // Fallback to loading JSON file (requires web server)
    console.log('Loading trials.json...');
    return $.getJSON('trials.json').then(function(trials) {
        TRIAL_DATA = trials;
        console.log('Loaded ' + trials.length + ' trials from trials.json');
        if (!trials || !Array.isArray(trials)) {
            return Promise.reject('trials.json does not contain a valid array');
        }
        return trials;
    }).fail(function(xhr, status, error) {
        console.error('Failed to load trials.json:', xhr, status, error);
        var errMsg = 'Error loading trials.json: ' + status;
        if (xhr.status === 404) {
            errMsg += '. File not found. Please run generate_trials.py to create trials.json';
        } else if (xhr.status === 0) {
            errMsg += '. CORS error - trials_data.js should be loaded instead. Please run generate_trials.py.';
        }
        errorMsg(errMsg);
        return Promise.reject(errMsg);
    });
}

// Generate trials - 48 trials of 30 test cases each
// Each test case is a single (problem_file, test_index) pair
// No test case appears in multiple trials
// No two test cases from the same problem file appear in the same trial
// NOTE: This should only be run once to create trials.json
function generateTrials() {
    if (TRIAL_DATA) {
        return Promise.resolve(TRIAL_DATA);
    }
    
    return getCorpus2TaskList().then(function(taskList) {
        // First, load all problem files to get test case counts
        var testCases = []; // Array of {problemIndex, testIndex, taskPath, taskName}
        var loadPromises = [];
        
        for (var i = 0; i < taskList.length; i++) {
            var task = taskList[i];
            var promise = $.getJSON(task.path).then(function(problemIndex, json) {
                var train = json['train'];
                var test = json['test'];
                
                // Determine usable test indices
                // If task has 10 tests, skip test 0 (use tests 1-9)
                // Otherwise, use all tests
                var usableTestIndices = [];
                if (test.length === 10) {
                    // Skip test 0, use tests 1-9
                    for (var j = 1; j < test.length; j++) {
                        usableTestIndices.push(j);
                    }
                } else {
                    // Use all tests
                    for (var j = 0; j < test.length; j++) {
                        usableTestIndices.push(j);
                    }
                }
                
                // Add all usable test cases
                for (var k = 0; k < usableTestIndices.length; k++) {
                    testCases.push({
                        problemIndex: problemIndex,
                        testIndex: usableTestIndices[k],
                        taskPath: taskList[problemIndex].path,
                        taskName: taskList[problemIndex].category + '/' + taskList[problemIndex].name,
                        train: train,
                        testCase: test[usableTestIndices[k]]
                    });
                }
            }.bind(null, i)).fail(function(problemIndex) {
                console.error('Failed to load problem:', taskList[problemIndex].path);
            });
            
            loadPromises.push(promise);
        }
        
        // Wait for all problems to load, then generate trials
        return Promise.all(loadPromises).then(function() {
            // Shuffle deterministically
            function deterministicShuffle(array, seed) {
                var shuffled = array.slice();
                var random = function() {
                    seed = (seed * 9301 + 49297) % 233280;
                    return seed / 233280;
                };
                for (var i = shuffled.length - 1; i > 0; i--) {
                    var j = Math.floor(random() * (i + 1));
                    var temp = shuffled[i];
                    shuffled[i] = shuffled[j];
                    shuffled[j] = temp;
                }
                return shuffled;
            }
            
            // Shuffle all test cases
            var shuffledTestCases = deterministicShuffle(testCases, 12345);
            
            // Track usage count for each test case to ensure all are used at least once
            var testCaseUsageCount = {};
            for (var i = 0; i < shuffledTestCases.length; i++) {
                var tc = shuffledTestCases[i];
                var key = tc.problemIndex + '_' + tc.testIndex;
                testCaseUsageCount[key] = 0;
            }
            
            // Generate 48 trials
            var trials = [];
            var testCaseIndex = 0;
            var totalTestCases = shuffledTestCases.length;
            var totalNeeded = 48 * 30; // 1440 test case slots
            
            console.log('Total test cases available:', totalTestCases);
            console.log('Total test case slots needed:', totalNeeded);
            
            for (var trialNum = 1; trialNum <= 48; trialNum++) {
                var trial = {
                    trialNumber: trialNum,
                    testCases: []
                };
                
                var usedProblemsInTrial = new Set(); // Track which problems are used in this trial
                var testCasesInTrial = [];
                
                // First pass: prioritize unused test cases (usage count = 0)
                // This ensures all test cases are used at least once before any reuse
                // We'll make multiple passes: first pass only uses unused test cases,
                // subsequent passes allow reuse if needed
                
                // Pass 1: Use only test cases that haven't been used yet
                for (var pass = 0; pass < shuffledTestCases.length && testCasesInTrial.length < 30; pass++) {
                    var testCase = shuffledTestCases[pass];
                    var testCaseKey = testCase.problemIndex + '_' + testCase.testIndex;
                    
                    // Skip if this problem is already used in this trial
                    if (usedProblemsInTrial.has(testCase.problemIndex)) {
                        continue;
                    }
                    
                    // Only use test cases that haven't been used yet
                    if (testCaseUsageCount[testCaseKey] === 0) {
                        testCasesInTrial.push(testCase);
                        testCaseUsageCount[testCaseKey]++;
                        usedProblemsInTrial.add(testCase.problemIndex);
                    }
                }
                
                // Second pass: if we still need more, allow reuse (but still no same problem in same trial)
                if (testCasesInTrial.length < 30) {
                    var secondPassIndex = 0;
                    while (testCasesInTrial.length < 30 && secondPassIndex < shuffledTestCases.length) {
                        var testCase = shuffledTestCases[secondPassIndex];
                        
                        // Only constraint: no same problem twice in same trial
                        if (!usedProblemsInTrial.has(testCase.problemIndex)) {
                            testCasesInTrial.push(testCase);
                            var testCaseKey = testCase.problemIndex + '_' + testCase.testIndex;
                            testCaseUsageCount[testCaseKey]++;
                            usedProblemsInTrial.add(testCase.problemIndex);
                        }
                        secondPassIndex++;
                    }
                }
                
                trial.testCases = testCasesInTrial;
                trials.push(trial);
            }
            
            // Verify coverage: check if all test cases were used at least once
            var uncoveredTestCases = [];
            for (var key in testCaseUsageCount) {
                if (testCaseUsageCount[key] === 0) {
                    uncoveredTestCases.push(key);
                }
            }
            
            if (uncoveredTestCases.length > 0) {
                console.warn('Warning: ' + uncoveredTestCases.length + ' test cases were not used in any trial');
            } else {
                console.log('All test cases are covered in the trials!');
            }
            
            TRIAL_DATA = trials;
            return trials;
        });
    });
}


function resetTask() {
    CURRENT_INPUT_GRID = new Grid(3, 3);
    TEST_PAIRS = new Array();
    CURRENT_TEST_PAIR_INDEX = 0;
    $('#task_preview').html('');
    resetOutputGrid();
}

function refreshEditionGrid(jqGrid, dataGrid) {
    fillJqGridWithData(jqGrid, dataGrid);
    setUpEditionGridListeners(jqGrid);
    fitCellsToContainer(jqGrid, dataGrid.height, dataGrid.width, EDITION_GRID_HEIGHT, EDITION_GRID_HEIGHT);
    initializeSelectable();
}

function syncFromEditionGridToDataGrid() {
    copyJqGridToDataGrid($('#output_grid .edition_grid'), CURRENT_OUTPUT_GRID);
}

function syncFromDataGridToEditionGrid() {
    refreshEditionGrid($('#output_grid .edition_grid'), CURRENT_OUTPUT_GRID);
}

function getSelectedSymbol() {
    selected = $('#symbol_picker .selected-symbol-preview')[0];
    return $(selected).attr('symbol');
}

function setUpEditionGridListeners(jqGrid) {
    jqGrid.find('.cell').click(function(event) {
        cell = $(event.target);
        symbol = getSelectedSymbol();

        mode = $('input[name=tool_switching]:checked').val();
        if (mode == 'floodfill') {
            // If floodfill: fill all connected cells.
            syncFromEditionGridToDataGrid();
            grid = CURRENT_OUTPUT_GRID.grid;
            floodfillFromLocation(grid, cell.attr('x'), cell.attr('y'), symbol);
            syncFromDataGridToEditionGrid();
        }
        else if (mode == 'edit') {
            // Else: fill just this cell.
            setCellSymbol(cell, symbol);
        }
    });
}

function resizeOutputGrid() {
    size = $('#output_grid_size').val();
    size = parseSizeTuple(size);
    height = size[0];
    width = size[1];

    jqGrid = $('#output_grid .edition_grid');
    syncFromEditionGridToDataGrid();
    dataGrid = JSON.parse(JSON.stringify(CURRENT_OUTPUT_GRID.grid));
    CURRENT_OUTPUT_GRID = new Grid(height, width, dataGrid);
    refreshEditionGrid(jqGrid, CURRENT_OUTPUT_GRID);
}

function resetOutputGrid() {
    syncFromEditionGridToDataGrid();
    CURRENT_OUTPUT_GRID = new Grid(3, 3);
    syncFromDataGridToEditionGrid();
    resizeOutputGrid();
}

function copyFromInput() {
    syncFromEditionGridToDataGrid();
    CURRENT_OUTPUT_GRID = convertSerializedGridToGridObject(CURRENT_INPUT_GRID.grid);
    syncFromDataGridToEditionGrid();
    $('#output_grid_size').val(CURRENT_OUTPUT_GRID.height + 'x' + CURRENT_OUTPUT_GRID.width);
}

function fillPairPreview(pairId, inputGrid, outputGrid) {
    var pairSlot = $('#pair_preview_' + pairId);
    if (!pairSlot.length) {
        // Create HTML for pair.
        pairSlot = $('<div id="pair_preview_' + pairId + '" class="pair_preview" index="' + pairId + '"></div>');
        pairSlot.appendTo('#task_preview');
    }
    var jqInputGrid = pairSlot.find('.input_preview');
    if (!jqInputGrid.length) {
        jqInputGrid = $('<div class="input_preview"></div>');
        jqInputGrid.appendTo(pairSlot);
    }
    var jqOutputGrid = pairSlot.find('.output_preview');
    if (!jqOutputGrid.length) {
        jqOutputGrid = $('<div class="output_preview"></div>');
        jqOutputGrid.appendTo(pairSlot);
    }

    fillJqGridWithData(jqInputGrid, inputGrid);
    fitCellsToContainer(jqInputGrid, inputGrid.height, inputGrid.width, 200, 200);
    fillJqGridWithData(jqOutputGrid, outputGrid);
    fitCellsToContainer(jqOutputGrid, outputGrid.height, outputGrid.width, 200, 200);
}

function loadJSONTask(train, test, taskName) {
    resetTask();
    $('#modal_bg').hide();
    $('#error_display').hide();
    $('#info_display').hide();
    
    // Store original task name
    if (taskName) {
        CURRENT_TASK_NAME = taskName;
    }

    for (var i = 0; i < train.length; i++) {
        pair = train[i];
        values = pair['input'];
        input_grid = convertSerializedGridToGridObject(values)
        values = pair['output'];
        output_grid = convertSerializedGridToGridObject(values)
        fillPairPreview(i, input_grid, output_grid);
    }
    for (var i=0; i < test.length; i++) {
        pair = test[i];
        TEST_PAIRS.push(pair);
    }
    values = TEST_PAIRS[0]['input'];
    CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values)
    fillTestInput(CURRENT_INPUT_GRID);
    CURRENT_TEST_PAIR_INDEX = 0;
    $('#current_test_input_id_display').html('1');
    $('#total_test_input_count_display').html(test.length);
}

function display_task_name(task_name, task_index, number_of_tasks) {
    big_space = '&nbsp;'.repeat(4);
    var hashed_name = hashTaskName(task_name);
    document.getElementById('task_name').innerHTML = (
        'Task name:' + big_space + hashed_name + big_space + (
            task_index===null ? '' :
            ( String(task_index) + ' out of ' + String(number_of_tasks) )
        )
    );
}

function loadTaskFromFile(e) {
    var file = e.target.files[0];
    if (!file) {
        errorMsg('No file selected');
        return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
        var contents = e.target.result;

        try {
            contents = JSON.parse(contents);
            train = contents['train'];
            test = contents['test'];
        } catch (e) {
            errorMsg('Bad file format');
            return;
        }
        loadJSONTask(train, test, file.name);

        $('#load_task_file_input')[0].value = "";
        display_task_name(file.name, null, null);
    };
    reader.readAsText(file);
}

function randomTask() {
    console.log('Loading random task...');
    
    // Check if we're running from file:// protocol (CORS will block AJAX requests)
    if (window.location.protocol === 'file:') {
        $('#modal_bg').show();
        errorMsg('Random task requires a web server due to browser security. Please use a trial number or load a task file. To use random task, run: python -m http.server 8000 (in tester/apps directory) and open http://localhost:8000/testing_interface.html');
        return;
    }
    
    getCorpus2TaskList().then(function(taskList) {
        if (!taskList || taskList.length === 0) {
            $('#modal_bg').show(); // Show modal if error
            errorMsg('No tasks available. Please check corpus-2 directory.');
            return;
        }
        console.log('Task list loaded:', taskList.length, 'tasks');
        var task_index = Math.floor(Math.random() * taskList.length);
        var task = taskList[task_index];
        console.log('Selected task:', task.path);
        $.getJSON(task.path, function(json) {
            try {
                var train = json['train'];
                var test = json['test'];
                if (!train || !test) {
                    $('#modal_bg').show(); // Show modal if error
                    errorMsg('Task file missing train or test data');
                    return;
                }
            } catch (e) {
                console.error('Error parsing task JSON:', e);
                $('#modal_bg').show(); // Show modal if error
                errorMsg('Bad file format: ' + e.message);
                return;
            }
            var fullTaskName = task.category + '/' + task.name;
            loadJSONTask(train, test, fullTaskName);
            display_task_name(fullTaskName, task_index, taskList.length);
        })
        .fail(function(xhr, status, error){
            console.error('Failed to load task:', task.path, xhr, status, error);
            $('#modal_bg').show(); // Show modal if error
            var errMsg = 'Error loading task: ' + task.path;
            if (xhr.status === 404) {
                errMsg += ' (File not found)';
            } else if (xhr.status === 0) {
                errMsg += ' (CORS error - try running from a local web server instead of file://)';
            } else {
                errMsg += ' (Status: ' + status + ')';
            }
            errorMsg(errMsg);
        });
    }).catch(function(error) {
        console.error('Error getting task list:', error);
        $('#modal_bg').show(); // Show modal if error
        errorMsg('Error getting task list: ' + (error.message || error));
    });
}

function loadTrialByNumber() {
    var trialNumber = parseInt($('#trial_number_input').val());
    if (!trialNumber || trialNumber < 1 || trialNumber > 48) {
        errorMsg('Please enter a valid trial number (1-48)');
        return;
    }
    
    console.log('Loading trial number:', trialNumber);
    loadTrialsFromFile().then(function(trials) {
        console.log('Trials loaded:', trials.length);
        if (!trials || trials.length === 0) {
            $('#modal_bg').show(); // Show modal if error
            errorMsg('No trials found in trials.json');
            return;
        }
        
        var trial = trials[trialNumber - 1];
        if (!trial) {
            $('#modal_bg').show(); // Show modal if error
            errorMsg('Trial ' + trialNumber + ' not found. Available trials: 1-' + trials.length);
            return;
        }
        
        if (!trial.testCases || trial.testCases.length === 0) {
            $('#modal_bg').show(); // Show modal if error
            errorMsg('Trial ' + trialNumber + ' has no test cases');
            return;
        }
        
        console.log('Trial found:', trial.trialNumber, 'with', trial.testCases.length, 'test cases');
        CURRENT_TRIAL = trial;
        CURRENT_TRIAL_INDEX = 0;
        SUBMISSION_DATA = []; // Reset submissions for new trial
        
        // Display first test case
        displayTrialTask(0);
    }).catch(function(error) {
        console.error('Error loading trial:', error);
        $('#modal_bg').show(); // Show modal if error
        errorMsg('Error loading trial: ' + (error.message || error));
    });
}

function displayTrialTask(index) {
    if (!CURRENT_TRIAL) {
        errorMsg('No trial loaded');
        return;
    }
    
    if (!CURRENT_TRIAL.testCases || CURRENT_TRIAL.testCases.length === 0) {
        errorMsg('Trial has no test cases');
        return;
    }
    
    if (index >= CURRENT_TRIAL.testCases.length) {
        errorMsg('All test cases in trial completed');
        return;
    }
    
    var testCaseData = CURRENT_TRIAL.testCases[index];
    if (!testCaseData) {
        errorMsg('Test case data not found at index ' + index);
        return;
    }
    
    CURRENT_TRIAL_INDEX = index;
    
    // Load the task with only the selected test case
    resetTask();
    $('#modal_bg').hide();
    $('#error_display').hide();
    $('#info_display').hide();
    
    CURRENT_TASK_NAME = testCaseData.taskName;
    
    // Display training examples
    for (var i = 0; i < testCaseData.train.length; i++) {
        var pair = testCaseData.train[i];
        var input_grid = convertSerializedGridToGridObject(pair['input']);
        var output_grid = convertSerializedGridToGridObject(pair['output']);
        fillPairPreview(i, input_grid, output_grid);
    }
    
    // Set up test case (only the selected one)
    TEST_PAIRS = [testCaseData.testCase];
    CURRENT_TEST_PAIR_INDEX = 0;
    
    var input_grid = convertSerializedGridToGridObject(testCaseData.testCase['input']);
    CURRENT_INPUT_GRID = input_grid;
    fillTestInput(CURRENT_INPUT_GRID);
    
    $('#current_test_input_id_display').html('1');
    $('#total_test_input_count_display').html('1');
    
    // Display trial progress
    var hashedName = hashTaskName(testCaseData.taskName);
    display_task_name(hashedName + ' (Trial ' + CURRENT_TRIAL.trialNumber + ', Test ' + (index + 1) + '/30)', null, null);
}

function nextTestInput() {
    if (TEST_PAIRS.length <= CURRENT_TEST_PAIR_INDEX + 1) {
        errorMsg('No next test input. Pick another file?')
        return
    }
    CURRENT_TEST_PAIR_INDEX += 1;
    values = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['input'];
    CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values)
    fillTestInput(CURRENT_INPUT_GRID);
    $('#current_test_input_id_display').html(CURRENT_TEST_PAIR_INDEX + 1);
    $('#total_test_input_count_display').html(TEST_PAIRS.length);
}

function submitSolution() {
    syncFromEditionGridToDataGrid();
    reference_output = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['output'];
    submitted_output = CURRENT_OUTPUT_GRID.grid;
    
    // Check if solution is correct
    var isCorrect = true;
    if (reference_output.length != submitted_output.length) {
        isCorrect = false;
    } else {
        for (var i = 0; i < reference_output.length; i++){
            ref_row = reference_output[i];
            if (!submitted_output[i]) {
                isCorrect = false;
                break;
            }
            for (var j = 0; j < ref_row.length; j++){
                if (ref_row[j] != submitted_output[i][j]) {
                    isCorrect = false;
                    break;
                }
            }
            if (!isCorrect) break;
        }
    }
    
    // Get rule description
    var ruleDescription = $('#rule_description').val() || '';
    
    // Get test index (for trials, this is the selected test index from the test case)
    var testIndex = CURRENT_TEST_PAIR_INDEX;
    if (CURRENT_TRIAL && CURRENT_TRIAL.testCases && CURRENT_TRIAL.testCases.length > CURRENT_TRIAL_INDEX) {
        testIndex = CURRENT_TRIAL.testCases[CURRENT_TRIAL_INDEX].testIndex;
    }
    
    // Save submission data
    var submission = {
        task_name: CURRENT_TASK_NAME,
        task_name_hash: CURRENT_TASK_NAME ? hashTaskName(CURRENT_TASK_NAME) : null,
        test_index: testIndex,
        input_grid: TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['input'],
        submitted_output: submitted_output,
        reference_output: reference_output,
        is_correct: isCorrect,
        rule_description: ruleDescription,
        timestamp: new Date().toISOString()
    };
    if (CURRENT_TRIAL) {
        submission.trial_number = CURRENT_TRIAL.trialNumber;
        submission.trial_task_index = CURRENT_TRIAL_INDEX;
    }
    SUBMISSION_DATA.push(submission);
    
    // Clear rule description
    $('#rule_description').val('');
    
    // Handle trial mode vs regular mode
    if (CURRENT_TRIAL && CURRENT_TRIAL.testCases && CURRENT_TRIAL.testCases.length > 0) {
        // Trial mode: move to next test case in trial
        if (CURRENT_TRIAL_INDEX + 1 < CURRENT_TRIAL.testCases.length) {
            // Move to next test case in trial
            displayTrialTask(CURRENT_TRIAL_INDEX + 1);
            resetOutputGrid();
        } else {
            // All test cases in trial completed - download JSON file
            var trialNumber = CURRENT_TRIAL.trialNumber;
            saveSubmissionData(trialNumber);
            
            // Redirect to completion page
            window.location.href = 'trial_complete.html?trial=' + trialNumber;
            
            CURRENT_TRIAL = null;
            CURRENT_TRIAL_INDEX = 0;
        }
    } else {
        // Regular mode: move to next test case in current task
        if (TEST_PAIRS.length > CURRENT_TEST_PAIR_INDEX + 1) {
            CURRENT_TEST_PAIR_INDEX += 1;
            values = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['input'];
            CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values);
            fillTestInput(CURRENT_INPUT_GRID);
            $('#current_test_input_id_display').html(CURRENT_TEST_PAIR_INDEX + 1);
            resetOutputGrid();
            // Save to file (download) for regular mode
            saveSubmissionData();
        } else {
            // No more test cases
            saveSubmissionData();
            infoMsg('All test cases completed!');
        }
    }
}

function fillTestInput(inputGrid) {
    jqInputGrid = $('#evaluation_input');
    fillJqGridWithData(jqInputGrid, inputGrid);
    fitCellsToContainer(jqInputGrid, inputGrid.height, inputGrid.width, 400, 400);
}

function copyToOutput() {
    syncFromEditionGridToDataGrid();
    CURRENT_OUTPUT_GRID = convertSerializedGridToGridObject(CURRENT_INPUT_GRID.grid);
    syncFromDataGridToEditionGrid();
    $('#output_grid_size').val(CURRENT_OUTPUT_GRID.height + 'x' + CURRENT_OUTPUT_GRID.width);
}

function initializeSelectable() {
    try {
        $('.selectable_grid').selectable('destroy');
    }
    catch (e) {
    }
    toolMode = $('input[name=tool_switching]:checked').val();
    if (toolMode == 'select') {
        infoMsg('Select some cells and click on a color to fill in, or press C to copy');
        $('.selectable_grid').selectable(
            {
                autoRefresh: false,
                filter: '> .row > .cell',
                start: function(event, ui) {
                    $('.ui-selected').each(function(i, e) {
                        $(e).removeClass('ui-selected');
                    });
                }
            }
        );
    }
}

// Initial event binding.

$(document).ready(function () {
    // Initialize submission file on app start
    initializeSubmissionFile();
    
    $('#symbol_picker').find('.symbol_preview').click(function(event) {
        symbol_preview = $(event.target);
        $('#symbol_picker').find('.symbol_preview').each(function(i, preview) {
            $(preview).removeClass('selected-symbol-preview');
        })
        symbol_preview.addClass('selected-symbol-preview');

        toolMode = $('input[name=tool_switching]:checked').val();
        if (toolMode == 'select') {
            $('.edition_grid').find('.ui-selected').each(function(i, cell) {
                symbol = getSelectedSymbol();
                setCellSymbol($(cell), symbol);
            });
        }
    });

    $('.edition_grid').each(function(i, jqGrid) {
        setUpEditionGridListeners($(jqGrid));
    });

    $('.load_task').on('change', function(event) {
        loadTaskFromFile(event);
    });

    $('.load_task').on('click', function(event) {
      event.target.value = "";
    });

    $('input[type=radio][name=tool_switching]').change(function() {
        initializeSelectable();
    });
    
    $('input[type=text][name=size]').on('keydown', function(event) {
        if (event.keyCode == 13) {
            resizeOutputGrid();
        }
    });
    
    $('#trial_number_input').on('keydown', function(event) {
        if (event.keyCode == 13) {
            loadTrialByNumber();
        }
    });
    
    // Load trials from static file on startup
    loadTrialsFromFile();

    $('body').keydown(function(event) {
        // Copy and paste functionality.
        if (event.which == 67) {
            // Press C

            selected = $('.ui-selected');
            if (selected.length == 0) {
                return;
            }

            COPY_PASTE_DATA = [];
            for (var i = 0; i < selected.length; i ++) {
                x = parseInt($(selected[i]).attr('x'));
                y = parseInt($(selected[i]).attr('y'));
                symbol = parseInt($(selected[i]).attr('symbol'));
                COPY_PASTE_DATA.push([x, y, symbol]);
            }
            infoMsg('Cells copied! Select a target cell and press V to paste at location.');

        }
        if (event.which == 86) {
            // Press P
            if (COPY_PASTE_DATA.length == 0) {
                errorMsg('No data to paste.');
                return;
            }
            selected = $('.edition_grid').find('.ui-selected');
            if (selected.length == 0) {
                errorMsg('Select a target cell on the output grid.');
                return;
            }

            jqGrid = $(selected.parent().parent()[0]);

            if (selected.length == 1) {
                targetx = parseInt(selected.attr('x'));
                targety = parseInt(selected.attr('y'));

                xs = new Array();
                ys = new Array();
                symbols = new Array();

                for (var i = 0; i < COPY_PASTE_DATA.length; i ++) {
                    xs.push(COPY_PASTE_DATA[i][0]);
                    ys.push(COPY_PASTE_DATA[i][1]);
                    symbols.push(COPY_PASTE_DATA[i][2]);
                }

                minx = Math.min(...xs);
                miny = Math.min(...ys);
                for (var i = 0; i < xs.length; i ++) {
                    x = xs[i];
                    y = ys[i];
                    symbol = symbols[i];
                    newx = x - minx + targetx;
                    newy = y - miny + targety;
                    res = jqGrid.find('[x="' + newx + '"][y="' + newy + '"] ');
                    if (res.length == 1) {
                        cell = $(res[0]);
                        setCellSymbol(cell, symbol);
                    }
                }
            } else {
                errorMsg('Can only paste at a specific location; only select *one* cell as paste destination.');
            }
        }
    });
});
