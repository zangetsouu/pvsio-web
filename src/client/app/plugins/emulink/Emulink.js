/**
 * 
 * @author Paolo Masci
 * @date 25/05/14 6:39:02 PM
 */
/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, d3, require, $, brackets, window, document, Promise */
define(function (require, exports, module) {
	"use strict";
	var stateMachine		= require("plugins/emulink/stateMachine"),
        handlerFile         = require("util/fileHandler"),
        pvsWriter           = require("plugins/emulink/stateToPvsSpecificationWriter"),
        parserSpecification = require("plugins/emulink/parserSpecification"),
		PrototypeBuilder	= require("plugins/prototypebuilder/PrototypeBuilder"),
        ProjectManager		= require("project/ProjectManager"),
        ModelEditor         = require("plugins/modelEditor/ModelEditor"),
		Logger				= require("util/Logger"),
        Simulator           = require("plugins/emulink/simulator"),
        PVSioWebClient      = require("PVSioWebClient"),
        EditorModeUtils     = require("plugins/emulink/EmuchartsEditorModes"),
        EmuchartsManager    = require("plugins/emulink/EmuchartsManager"),
        displayAddState        = require("plugins/emulink/forms/displayAddState"),
        displayAddTransition   = require("plugins/emulink/forms/displayAddTransition"),
        displayRename          = require("plugins/emulink/forms/displayRename"),
        displayDelete          = require("plugins/emulink/forms/displayDelete"),
        displayAddExpression   = require("plugins/emulink/forms/displayAddExpression"),
        displayAddVariable     = require("plugins/emulink/forms/displayAddVariable"),
        displayEditVariable    = require("plugins/emulink/forms/displayEditVariable"),
        displaySelectVariable  = require("plugins/emulink/forms/displaySelectVariable"),
        displayAddConstant     = require("plugins/emulink/forms/displayAddConstant"),
        displayEditConstant    = require("plugins/emulink/forms/displayEditConstant"),
        displaySelectConstant  = require("plugins/emulink/forms/displaySelectConstant"),
        QuestionForm           = require("pvsioweb/forms/displayQuestion"),
        EmuchartsPVSPrinter    = require("plugins/emulink/EmuchartsPVSPrinter"),
        EmuchartsLustrePrinter = require("plugins/emulink/EmuchartsLustrePrinter"),
        EmuchartsPIMPrinter    = require("plugins/emulink/EmuchartsPIMPrinter"),
        EmuchartsCppPrinter    = require("plugins/emulink/EmuchartsCppPrinter"),
        EmuchartsMALPrinter    = require("plugins/emulink/EmuchartsMALPrinter"),
        fs = require("util/fileHandler"),
        displayNotificationView  = require("plugins/emulink/forms/displayNotificationView");
    
    var instance;
    var projectManager;
    var editor;
    var ws;
    var selectedFileChanged;
    var pvsioWebClient;
    var canvas;
    
    var emuchartsManager;
    var MODE;
    var emuchartsPVSPrinter;
    var emuchartsLustrePrinter;
    var emuchartsPIMPrinter;
    var emuchartsCppPrinter;
    var emuchartsMALPrinter;
    var options = { autoinit: true };

    var displayNotification = function (msg, title) {
        title = title || "Notification";
        displayNotificationView.create({
            header: title,
            message: msg,
            buttons: ["Ok"]
        }).on("ok", function (e, view) {
            view.remove();
        });
    };

    function resetToolbarColors() {
        // make sure the svg is visible
        d3.select("#EmuchartLogo").classed("hidden", true);
        d3.select("#graphicalEditor").classed("hidden", false);
        // reset toolbar color
        document.getElementById("btn_toolbarBrowse").style.background = "black";
        document.getElementById("btn_toolbarAddState").style.background = "black";
        document.getElementById("btn_toolbarAddTransition").style.background = "black";
        document.getElementById("btn_toolbarRename").style.background = "black";
        document.getElementById("btn_toolbarDelete").style.background = "black";
    }
    
	function modeChange_callback(event) {
		var EmuchartsEditorMode = document.getElementById("EmuchartsEditorMode");
		if (EmuchartsEditorMode) {
            if (event.mode === MODE.BROWSE()) {
                EmuchartsEditorMode.style.background = "green";
            } else { EmuchartsEditorMode.style.background = "steelblue"; }
			EmuchartsEditorMode.textContent = "Editor mode: " + MODE.mode2string(event.mode);
		}
		var infoBox = document.getElementById("infoBox");
		if (infoBox) {
			infoBox.value = MODE.modeTooltip(event.mode);
		}
	}

    function addState_handler(evt) {
        var stateID = emuchartsManager.getFreshStateName();
        var position = { x: evt.mouse[0], y: evt.mouse[1] };
        emuchartsManager.add_state(stateID, position);
        if (options.autoinit && emuchartsManager.getStates().length === 1) {
            var newTransitionName = emuchartsManager.getFreshInitialTransitionName();
            emuchartsManager.add_initial_transition(newTransitionName, stateID);
        }
    }
    
    function deleteTransition_handler(event) {
        var transitionID = event.edge.id;
        emuchartsManager.delete_transition(transitionID);
    }
    
    function deleteInitialTransition_handler(event) {
        var transitionID = event.edge.id;
        emuchartsManager.delete_initial_transition(transitionID);
    }

    function deleteState_handler(event) {
        var stateID = event.node.id;
        emuchartsManager.delete_state(stateID);
    }

    function renameState_handler(event) {
        var node = event.node;
        // popup rename window
        var labels = [];
        labels.push(node.name + "  (id: " + node.id + ")");
        displayRename.create({
            header: "Please enter new label...",
            textLabel: "State",
            currentLabels: labels, // this will show just one label, that of the node selected for renaming
            buttons: ["Cancel", "Rename"]
        }).on("rename", function (e, view) {
            var newLabel = e.data.labels.get("newLabel");
            if (newLabel && newLabel.value !== "") {
                emuchartsManager.rename_state(node.id, newLabel);
                view.remove();
            }
        }).on("cancel", function (e, view) {
            // just remove rename window
            view.remove();
        });
    }
    
    function renameTransition_handler(event) {
        var edge = event.edge;
        // popup rename window
        var oldName = edge.name;
        var labels = [];
        labels.push(edge.name + "  ("
                    + edge.source.name + "->"
                    + edge.target.name + ")");
        displayRename.create({
            header: "Please enter new label...",
            textLabel: "Transition",
            currentLabels: labels,
            buttons: ["Cancel", "Rename"]
        }).on("rename", function (e, view) {
            var transitionLabel = e.data.labels.get("newLabel");
            if (transitionLabel && transitionLabel.value !== "") {
                emuchartsManager.rename_transition(edge.id, transitionLabel);
                view.remove();
            }
        }).on("cancel", function (e, view) {
            // just remove rename window
            view.remove();
        });
    }

    function renameInitialTransition_handler(event) {
        var edge = event.edge;
        // popup rename window
        var oldName = edge.name;
        var labels = [];
        labels.push(edge.name + "  ("
                    + "init ->"
                    + edge.target.name + ")");
        displayRename.create({
            header: "Please enter new label...",
            textLabel: "Transition",
            currentLabels: labels,
            buttons: ["Cancel", "Rename"]
        }).on("rename", function (e, view) {
            var transitionLabel = e.data.labels.get("newLabel");
            if (transitionLabel && transitionLabel.value !== "") {
                emuchartsManager.rename_initial_transition(edge.id, transitionLabel);
                view.remove();
            }
        }).on("cancel", function (e, view) {
            // just remove rename window
            view.remove();
        });
    }

    function addTransition_handler(event) {
        var newTransitionName = emuchartsManager.getFreshTransitionName();
        emuchartsManager.add_transition(newTransitionName,
                                        event.source.id,
                                        event.target.id);
    }
    
    function addInitialTransition_handler(event) {
        var newTransitionName = emuchartsManager.getFreshInitialTransitionName();
        emuchartsManager.add_initial_transition(newTransitionName, event.target.id);
    }
    
    // dbg
    function print_theory() {
        var emuchart = {
            name: "emuchart_th",
            author: {
                name: "Paolo Masci",
                affiliation: "Queen Mary University of London, United Kingdom",
                contact: "http://www.eecs.qmul.ac.uk/~masci/"
            },
            importings: [],
            constants: emuchartsManager.getConstants(),
            variables: emuchartsManager.getVariables(),
            states: emuchartsManager.getStates(),
            transitions: emuchartsManager.getTransitions()
        };
        console.log(emuchartsPVSPrinter.print(emuchart));
    }
    function print_node() {
        var emuchart = {
            name: "foo",
            author: {
                name: "XXX",
                affiliation: "YYY",
                contact: "XXX@YYY"
            },
            importings: [],
            constants: emuchartsManager.getConstants(),
            variables: {
                input: emuchartsManager.getInputVariables(),
                output: emuchartsManager.getOutputVariables(),
                local: emuchartsManager.getLocalVariables()
            },
            states: emuchartsManager.getStates(),
            transitions: emuchartsManager.getTransitions()
        };
        console.log(emuchartsLustrePrinter.print(emuchart));
    }
    
    function stateAdded_handler(event) { }//print_theory(); print_node(); }
    function stateRemoved_handler(event) { }//print_theory(); print_node(); }
    function stateRenamed_handler(event) { }//print_theory(); print_node(); }
    function transitionAdded_handler(event) { }//print_theory(); print_node(); }
    function transitionRemoved_handler(event) { }//print_theory(); print_node(); }
    function transitionRenamed_handler(event) { }//print_theory(); print_node(); }
    function initialTransitionAdded_handler(event) { }//console.log("initial transition added"); }//print_theory(); print_node(); }
    function initialTransitionRemoved_handler(event) { }//console.log("initial transition removed"); }//print_theory(); print_node(); }
    function initialTransitionRenamed_handler(event) { }//console.log("initial transition renamed"); }//print_theory(); print_node(); }    
    function constantAdded_handler(event) { }//print_theory(); print_node(); }
    function variableAdded_handler(event) { }//print_theory(); print_node(); }
    
    

    /**
	 * Constructor
	 * @memberof Emulink
	 */
    function Emulink() {
        emuchartsPVSPrinter = new EmuchartsPVSPrinter("emuchart_th");
        emuchartsLustrePrinter = new EmuchartsLustrePrinter("emuchart_Lustre");
        emuchartsPIMPrinter = new EmuchartsPIMPrinter("emuchart_PIM");
        emuchartsCppPrinter = new EmuchartsCppPrinter("emuchart_Cpp");
        emuchartsMALPrinter = new EmuchartsMALPrinter("emuchart_MAL");
        pvsioWebClient = PVSioWebClient.getInstance();
        MODE = new EditorModeUtils();
        emuchartsManager = new EmuchartsManager();
        emuchartsManager.addListener("emuCharts_editorModeChanged", modeChange_callback);
        emuchartsManager.addListener("emuCharts_addState", addState_handler);
//        emuchartsManager.addListener("emuCharts_d3ZoomTranslate", d3ZoomTranslate_handler);
        emuchartsManager.addListener("emuCharts_deleteTransition", deleteTransition_handler);
        emuchartsManager.addListener("emuCharts_deleteInitialTransition", deleteInitialTransition_handler);
        emuchartsManager.addListener("emuCharts_deleteState", deleteState_handler);
        emuchartsManager.addListener("emuCharts_renameState", renameState_handler);
        emuchartsManager.addListener("emuCharts_renameTransition", renameTransition_handler);
        emuchartsManager.addListener("emuCharts_renameInitialTransition", renameInitialTransition_handler);
        emuchartsManager.addListener("emuCharts_addTransition", addTransition_handler);
        emuchartsManager.addListener("emuCharts_addInitialTransition", addInitialTransition_handler);
        
        emuchartsManager.addListener("emuCharts_stateAdded", stateAdded_handler);
        emuchartsManager.addListener("emuCharts_stateRemoved", stateRemoved_handler);
        emuchartsManager.addListener("emuCharts_constantAdded", constantAdded_handler);
        emuchartsManager.addListener("emuCharts_variableAdded", variableAdded_handler);
        emuchartsManager.addListener("emuCharts_transitionAdded", transitionAdded_handler);
        emuchartsManager.addListener("emuCharts_transitionRenamed", transitionRenamed_handler);
        emuchartsManager.addListener("emuCharts_transitionRemoved", transitionRemoved_handler);
        emuchartsManager.addListener("emuCharts_initialTransitionAdded", initialTransitionAdded_handler);
        emuchartsManager.addListener("emuCharts_initialTransitionRenamed", initialTransitionRenamed_handler);
        emuchartsManager.addListener("emuCharts_initialTransitionRemoved", initialTransitionRemoved_handler);
        emuchartsManager.addListener("emuCharts_stateRenamed", stateRenamed_handler);
	}
    
	Emulink.prototype.createHtmlElements = function () {
        var _this = this;
		var content = require("text!plugins/emulink/forms/maincontent.handlebars");
        canvas = pvsioWebClient.createCollapsiblePanel({
            headerText: "Emulink",
            showContent: true,
            owner: "Emulink"
        });
        canvas = canvas.html(content);
		var infoBox = document.getElementById("EmuchartsEditorMode");
		if (infoBox) {
			infoBox.style.background = "seagreen";
			infoBox.style.color = "white";
			infoBox.style.cursor = "default";
		}
        
        // add listeners
        // this first listner is obsolete
        d3.select("#button_newDiagram").on("click", function () {
			stateMachine.init(editor, ws, projectManager);
            d3.select("#EmuchartLogo").classed("hidden", true);
            d3.select("#graphicalEditor").classed("hidden", false);
		});
        d3.select("#button_state").on("click", function () {
			stateMachine.add_node_mode();
		});
        d3.select("#button_transition").on("click", function () {
			stateMachine.add_transition_mode();
		});
        d3.select("#button_self_transition").on("click", function () {
			stateMachine.add_self_transition_mode();
		});
		d3.select("#button_add_field").on("click", function () {
			stateMachine.add_field_mode_start();
			var newField =
                prompt("Please enter type and name"
                        + " of the new state variable"
                        + " (for example, int value)",
					   "fieldtype fieldname");
			if (!newField || newField.split(' ').length !== 2) {
                alert("Wrong format: new state variable has not been added");
				return stateMachine.add_field_mode_end(null, null);
			}
			var field_name = newField.split(' ')[0];
			var field_type = newField.split(' ')[1];
			var msg = "State variable " + field_name
					+ " of type " + field_type + " successfully added.";
			stateMachine.add_field_mode_end(field_name, field_type, msg);
		});
    
        /// User wants to perform an undo operation on the Editor    
        d3.select("#undoEditor").on("click", function () {
            pvsWriter.undo();
        });
        
        /// User want to perform a redo operation on the Editor 
        d3.select("#redoEditor").on("click", function () {
            pvsWriter.redo();
        });
    
        d3.select("#editor").on("click", function () {
            pvsWriter.click();
        });
    
        d3.select("#hideTags").on("click", function () {
            pvsWriter.hideTags();
        });
    
        d3.select("#showTags").on("click", function () {
            pvsWriter.showTags();
        });

        d3.select("#specificationToDiagram").on("click", function () {
            // User has just copied into the editor without opening any project
//            if (currentProject.pvsFilesList().length === 0) {
//                currentProject.name("default_pvsProject");
//                EmulinkFile.new_file(currentProject, editor,
//									 ws, "TheoryEmulink.pvs",
//                                     editor.getValue(), projectManager);
//            }
//            parserSpecification.init(editor, stateMachine, currentProject,
//										ws, projectManager, selectedFileChanged);
//            emulinkHasBeenUsed = true;
        });
        
        
        d3.select("#startSimulation").on("click", function () {
            var simulationIsActive = Simulator.init(ws);
            if (simulationIsActive) { d3.select(this).html("Disable Animation");
                } else { d3.select(this).html("Enable Animation"); }
            //Simulator.setInitState("INITSTATE");
        });
	
        /* d3.select("#infoBoxModifiable").on("change", function () {
	
	    stateMachine.changeTextArea();
	 
        });*/
/*        document.getElementById("emulinkInfo").value = "Emulink status: NOT active";
        document.getElementById("startEmulink").disabled = false;
        /// User wants to start emulink 
        d3.select("#startEmulink").on("click", function () {
			//d3.select(this).html("Diagram created").classed("btn-danger", false).classed("btn-success", true).attr("disabled", true);
            if( ! emulinkHasBeenUsed )
            {   
                showEmulinkStatus();
	            stateMachine.init(editor, ws, currentProject, projectManager, true);
                currentProject.name("default_pvsProject");
                emulinkHasBeenUsed = true;
            }
            stateMachine.addNewDiagram();          
        });    
	   */

        // bootstrap buttons
        function openChart(callback) {
            var opt = {
                header: "Open EmuChart file...",
                extensions: ".emdl,.muz"
            };
            fs.openLocalFileAsText(function (err, res) {
                if (res) {
                    if (res.fileName.lastIndexOf(".emdl") === res.fileName.length - 5) {
                        res.fileContent = JSON.parse(res.fileContent);
                        emuchartsManager.importEmucharts(res);
                        if (callback && typeof callback === "function") {
                            callback(err, res);
                        }
                    } else {
                        emuchartsManager.importPIMChart(res);
                        if (callback && typeof callback === "function") {
                            callback(err, res);
                        }
                    }
                } else {
                    console.log("Error while opening file (" + err + ")");
                }
            }, opt);
        }
//        function openChart(callback) {
//            var opt = {
//                header: "Open EmuChart file...",
//                extensions: ".emdl"
//            };
//            fs.openLocalFileAsJSON(function (err, res) {
//                if (res) {
//                    emuchartsManager.importEmucharts(res);
//                    if (callback && typeof callback === "function") {
//                        callback(err, res);
//                    }
//                }
//            }, opt);
//        }
        function importChart(callback) {
            var opt = {
                header: "Import Chart...",
                extensions: ".muz"
            };
            // MUZ
            fs.openLocalFileAsText(function (err, res) {
                if (res) {
                    emuchartsManager.importPIMChart(res);
                    if (callback && typeof callback === "function") {
                        callback(err, res);
                    }
                }
            }, opt);
        }

        d3.select("#btnNewEmuchart").on("click", function () {
            d3.select("#EmuchartLogo").classed("hidden", true);
            d3.select("#graphicalEditor").classed("hidden", false);
            emuchartsManager.newEmucharts("emucharts.pvs");
            // render emuchart
            emuchartsManager.render();
            // make svg visible and reset colors
            resetToolbarColors();
            // set initial editor mode
            d3.select("#btn_toolbarBrowse").node().click();
        });
        d3.select("#btnLoadEmuchart").on("click", function () {
            openChart(function f() {
                // make svg visible and reset colors
                resetToolbarColors();
                // render emuchart                        
                emuchartsManager.render();
                // set initial editor mode
                d3.select("#btn_toolbarBrowse").node().click();
            });
		});
//        d3.select("#btnImportChart").on("click", function () {
//            importChart(function f() {
//                // set initial editor mode
//                emuchartsManager.set_editor_mode(MODE.BROWSE());
//                // render emuchart                        
//                emuchartsManager.render();
//                // make svg visible and reset colors
//                resetToolbarColors();
//            });
//		});
        
        // toolbar
        d3.select("#btn_toolbarAddState").on("click", function () {
            resetToolbarColors();
            this.style.background = "steelblue";
            emuchartsManager.set_editor_mode(MODE.ADD_STATE());
        });
        d3.select("#btn_toolbarAddTransition").on("click", function () {
            resetToolbarColors();
            this.style.background = "steelblue";
            emuchartsManager.set_editor_mode(MODE.ADD_TRANSITION());
        });
        d3.select("#btn_toolbarRename").on("click", function () {
            resetToolbarColors();
            this.style.background = "steelblue";
            emuchartsManager.set_editor_mode(MODE.RENAME());
        });
        d3.select("#btn_toolbarDelete").on("click", function () {
            resetToolbarColors();
            this.style.background = "steelblue";
            emuchartsManager.set_editor_mode(MODE.DELETE());
        });
        d3.select("#btn_toolbarBrowse").on("click", function () {
            resetToolbarColors();
            this.style.background = "green";
            emuchartsManager.set_editor_mode(MODE.BROWSE());
        });
        d3.select("#btn_toolbarZoomIn").on("click", function () {
            emuchartsManager.zoom_in();
        });
        d3.select("#btn_toolbarZoomOut").on("click", function () {
            emuchartsManager.zoom_out();
        });
        d3.select("#btn_toolbarZoomReset").on("click", function () {
            emuchartsManager.zoom_reset();
        });


        
        
        //-- Emuchart menu -----------------------------------------------------------
        d3.select("#menuEmuchart").on("mouseover", function () {
            document.getElementById("menuEmuchart").children[1].style.display = "block";
        });
        d3.select("#btn_menuNewChart").on("click", function () {
            document.getElementById("menuEmuchart").children[1].style.display = "none";
            var newChart = function () {
                d3.select("#EmuchartLogo").classed("hidden", true);
                d3.select("#graphicalEditor").classed("hidden", false);
                emuchartsManager.newEmucharts("emucharts.pvs");
                // set initial editor mode
                emuchartsManager.set_editor_mode(MODE.BROWSE());
                // render emuchart
                emuchartsManager.render();
            };
            if (!emuchartsManager.empty_chart()) {
                // we need to delete the current chart because we handle one chart at the moment
                QuestionForm.create({
                    header: "Warning: unsaved changes will be discarded.",
                    question: "Unsaved changes in the current chart will be discarded."
                                + "Would you like continue?",
                    buttons: ["Cancel", "Ok"]
                }).on("ok", function (e, view) {
                    emuchartsManager.delete_chart();
                    newChart();
                    resetToolbarColors();
                    // set initial editor mode
                    d3.select("#btn_toolbarBrowse").node().click();
                    view.remove();
                }).on("cancel", function (e, view) {
                    view.remove();
                });
            }
        });
        d3.select("#btn_menuCloseChart").on("click", function () {
            document.getElementById("menuEmuchart").children[1].style.display = "none";
            if (!emuchartsManager.empty_chart()) {
                // we need to delete the current chart because we handle one chart at the moment
                QuestionForm.create({
                    header: "Warning: the current chart has unsaved changes.",
                    question: "The current chart has unsaved changes that will be lost. Confirm Close?",
                    buttons: ["Cancel", "Confirm close"]
                }).on("ok", function (e, view) {
                    emuchartsManager.delete_chart();
                    resetToolbarColors();
                    // set initial editor mode
                    d3.select("#btn_toolbarBrowse").node().click();
                    view.remove();
                }).on("cancel", function (e, view) {
                    view.remove();
                });
            }
        });
        d3.select("#btn_menuOpenChart").on("click", function () {
            document.getElementById("menuEmuchart").children[1].style.display = "none";
            // we need to delete the current chart because we handle one chart at the moment
            QuestionForm.create({
                header: "Warning: unsaved changes will be discarded.",
                question: "Unsaved changes in the current chart will be discarded."
                            + "Would you like continue?",
                buttons: ["Cancel", "Ok"]
            }).on("ok", function (e, view) {
                emuchartsManager.delete_chart();
                document.getElementById("btnLoadEmuchart").click();
                view.remove();
            }).on("cancel", function (e, view) {
                view.remove();
            });
		});
        d3.select("#btn_menuImportChart").on("click", function () {
            document.getElementById("menuEmuchart").children[1].style.display = "none";
            // we need to delete the current chart because we handle one chart at the moment
            QuestionForm.create({
                header: "Warning: unsaved changes will be discarded.",
                question: "Unsaved changes in the current chart will be discarded."
                            + "Would you like continue?",
                buttons: ["Cancel", "Ok"]
            }).on("ok", function (e, view) {
                emuchartsManager.delete_chart();
                //document.getElementById("btnImportChart").click();
                view.remove();
                importChart(function f() {
                    // render emuchart                        
                    emuchartsManager.render();
                    // make svg visible and reset colors
                    resetToolbarColors();
                    // set initial editor mode
                    d3.select("#btn_toolbarBrowse").node().click();
                });
            }).on("cancel", function (e, view) {
                view.remove();
            });
		});
        d3.select("#btn_menuQuitEmulink").on("click", function () {
            document.getElementById("menuEmuchart").children[1].style.display = "none";
            if (!emuchartsManager.empty_chart()) {
                // we need to delete the current chart because we handle one chart at the moment
                QuestionForm.create({
                    header: "Warning: the current chart has unsaved changes.",
                    question: "The current chart has unsaved changes that will be lost. Confirm quit?",
                    buttons: ["Cancel", "Quit Emulink"]
                }).on("ok", function (e, view) {
                    emuchartsManager.delete_chart();
                    resetToolbarColors();
                    view.remove();
                    // FIXME: need a better way to deselect the checkbox
                    document.getElementById("plugin_Emulink").checked = false;
                    _this.unload();
                }).on("cancel", function (e, view) {
                    view.remove();
                });
            }
        });
        d3.select("#btn_menuSaveChart").on("click", function () {
            document.getElementById("menuEmuchart").children[1].style.display = "none";
            if (!emuchartsManager.empty_chart()) {
                var fileName = projectManager.project().name() + "_emucharts.emdl";
                var content = JSON.stringify({
                    descriptor: {
                        file_type: "emdl",
                        version: "1.1",
                        description: "emucharts model",
                        chart_name: (projectManager.project().name() + "_emucharts"),
                        pvs_file: (projectManager.project().name() + "_emucharts_th.pvs")
                    },
                    chart: {
                        states: emuchartsManager.getStates(),
                        transitions: emuchartsManager.getTransitions(),
                        initial_transitions: emuchartsManager.getInitialTransitions(),
                        constants: emuchartsManager.getConstants(),
                        variables: emuchartsManager.getVariables()
                    }
                }, null, " ");
                var pf = projectManager.createProjectFile(fileName, content);
                projectManager.saveFiles([pf], function (err, res) {
                    if (!err) {
                        displayNotification("File " + pf.path() + " saved successfully!");
                    } else {
                        displayNotification("Error while saving file " + pf.path() + " (" + err + ")");
                    }
                });
            }
        });
        d3.select("#btn_menuExportAsImage").on("click", function () {
            var svg = d3.select("#ContainerStateMachine").select("svg")
                        .attr("version", 1.1)
                        .attr("xmlns", "http://www.w3.org/2000/svg")
                        //.attr("xmlns:xlink", "http://www.w3.org/1999/xlink")
                        .style("background", "#ffffff")
                        .node();
            var SVGContent = (new window.XMLSerializer()).serializeToString(svg);
            // this workaround is needed to define the xlink namespace -- d3 for some reason does not allow to define it but we need it to export the svg as an image
            SVGContent = SVGContent.replace("xmlns=\"http://www.w3.org/2000/svg\"",
                                            "xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"");
            var imgsrc = "data:image/svg+xml;base64," + window.btoa(SVGContent);
            var img = '<img src="' + imgsrc + '">';
            d3.select("#svgdataurl").html(img);
            var canvas = document.querySelector("canvas");
            var context = canvas.getContext("2d");
            var image = new Image();
            
            // restore background colour
            d3.select("#ContainerStateMachine").select("svg").style("background", "white");
            
            function imageLoadError(res) {
                displayNotification("Failed to export chart");
            }
            function imageLoadComplete(res) {
                context.drawImage(image, 0, 0);
                var canvasdata = canvas.toDataURL("image/png");
                var pngimg = '<img src="' + canvasdata + '">';
                d3.select("#pngdataurl").html(pngimg);
                var a = document.createElement("a");
                a.download = "emuChart.png";
                a.href = canvasdata;
                a.click();
            }

            image.onload = imageLoadComplete;
            image.onerror = imageLoadError;
            image.src = imgsrc;
        });
        
        //-- States menu -----------------------------------------------------------
        d3.select("#menuStates").on("mouseover", function () {
            document.getElementById("menuStates").children[1].style.display = "block";
        });

        d3.select("#btn_menuNewState").on("click", function () {
            document.getElementById("menuStates").children[1].style.display = "none";
            var label = emuchartsManager.getFreshStateName();
            displayAddState.create({
                header: "Please enter label for new state",
                textLabel: "New state",
                buttons: ["Cancel", "Create"]
            }).on("create", function (e, view) {
                var nodeLabel = e.data.labels.get("newLabel");
                emuchartsManager.add_state(nodeLabel);
                view.remove();
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
            });
        });
        d3.select("#btn_menuRenameState").on("click", function () {
            document.getElementById("menuStates").children[1].style.display = "none";
            var states = emuchartsManager.getStates();
            var labels = [];
            states.forEach(function (state) {
                labels.push(state.name + "  (id: " + state.id + ")");
            });
            displayRename.create({
                header: "Please select state and enter new label...",
                textLabel: "Select state",
                currentLabels: labels,
                buttons: ["Cancel", "Rename"]
            }).on("rename", function (e, view) {
                var stateLabel = e.data.labels.get("newLabel");
                if (stateLabel && stateLabel.value !== "") {
                    var s = e.data.options.get("currentLabel");
                    var stateID = states[s].id;
                    emuchartsManager.rename_state(stateID, stateLabel);
                    view.remove();
                }
            }).on("cancel", function (e, view) {
                // just remove rename window
                view.remove();
            });
        });
        d3.select("#btn_menuDeleteState").on("click", function () {
            document.getElementById("menuStates").children[1].style.display = "none";
            var states = emuchartsManager.getStates();
            var labels = [];
            states.forEach(function (state) {
                labels.push(state.name + "  (id: " + state.id + ")");
            });
            displayDelete.create({
                header: "Please select state to be deleted...",
                textLabel: "State to be deleted",
                currentLabels: labels,
                buttons: ["Cancel", "Delete"]
            }).on("delete", function (e, view) {
                var s = e.data.options.get("currentLabel");
                var stateID = states[s].id;
                emuchartsManager.delete_state(stateID);
                view.remove();
            }).on("cancel", function (e, view) {
                // just remove rename window
                view.remove();
            });
        });
        
        //-- Transitions menu -----------------------------------------------------------
        d3.select("#menuTransitions").on("mouseover", function () {
            document.getElementById("menuTransitions").children[1].style.display = "block";
        });
        d3.select("#btn_menuNewTransition").on("click", function () {
            document.getElementById("menuTransitions").children[1].style.display = "none";
            var newTransitionName = emuchartsManager.getFreshTransitionName();
            var states = emuchartsManager.getStates();
            var labels = [];
            states.forEach(function (state) {
                labels.push(state.name + "  (id: " + state.id + ")");
            });
            displayAddTransition.create({
                header: "Please enter label for new transition",
                textLabel: "New transition",
                sourceNodes: labels,
                targetNodes: labels,
                buttons: ["Cancel", "Create"]
            }).on("create", function (e, view) {
                var transitionLabel = e.data.labels.get("newLabel");
                if (transitionLabel && transitionLabel.value !== "") {
                    var sourceNode = e.data.options.get("sourceNode");
                    var sourceNodeID = states[sourceNode].id;
                    var targetNode = e.data.options.get("targetNode");
                    var targetNodeID = states[targetNode].id;
                    emuchartsManager.add_transition(transitionLabel, sourceNodeID, targetNodeID);
                    view.remove();
                }
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
            });
        });
        d3.select("#btn_menuRenameTransition").on("click", function () {
            document.getElementById("menuTransitions").children[1].style.display = "none";
            var transitions = emuchartsManager.getTransitions();
            var initialTransitions = emuchartsManager.getInitialTransitions();
            initialTransitions.forEach(function (it) {
                transitions.push(it);
            });
            var labels = [];
            transitions.forEach(function (transition) {
                if (transition.source) {
                    labels.push(transition.name + "  ("
                                + transition.source.name + "->"
                                + transition.target.name + ")");
                } else {
                    labels.push(transition.name + "  ("
                                + "INIT" + "->"
                                + transition.target.name + ")");
                }
            });
            displayRename.create({
                header: "Please select transition and enter new label...",
                textLabel: "Select transition",
                currentLabels: labels,
                buttons: ["Cancel", "Rename"]
            }).on("rename", function (e, view) {
                var transitionLabel = e.data.labels.get("newLabel");
                var t = e.data.options.get("currentLabel");
                var transitionID = transitions[t].id;
                emuchartsManager.rename_transition(transitionID, transitionLabel);
                emuchartsManager.rename_initial_transition(transitionID, transitionLabel);
                view.remove();
            }).on("cancel", function (e, view) {
                // just remove rename window
                view.remove();
            });
        });
        d3.select("#btn_menuDeleteTransition").on("click", function () {
            document.getElementById("menuTransitions").children[1].style.display = "none";
            var transitions = emuchartsManager.getTransitions();
            var initialTransitions = emuchartsManager.getInitialTransitions();
            initialTransitions.forEach(function (it) {
                transitions.push(it);
            });
            var labels = [];
            transitions.forEach(function (transition) {
                if (transition.source) {
                    labels.push(transition.name + "  ("
                                + transition.source.name + "->"
                                + transition.target.name + ")");
                } else {
                    labels.push(transition.name + "  ("
                                + "INIT" + "->"
                                + transition.target.name + ")");
                }
            });
            displayDelete.create({
                header: "Please select transition to be deleted...",
                textLabel: "Transition to be deleted",
                currentLabels: labels,
                buttons: ["Cancel", "Delete"]
            }).on("delete", function (e, view) {
                var t = e.data.options.get("currentLabel");
                var transitionID = transitions[t].id;
                emuchartsManager.delete_transition(transitionID);
                emuchartsManager.delete_initial_transition(transitionID);
                view.remove();
            }).on("cancel", function (e, view) {
                // just remove rename window
                view.remove();
            });
        });
        
        //-- Context menu -----------------------------------------------------------
        d3.select("#menuContext").on("mouseover", function () {
            document.getElementById("menuContext").children[1].style.display = "block";
        });
        d3.select("#btn_menuNewVariable").on("click", function () {
            document.getElementById("menuContext").children[1].style.display = "none";
            var scopeOptions = emuchartsManager.getVariableScopes();
            displayAddVariable.create({
                header: "Please enter new state variable...",
                textLabel: {
                    newVariableName: "Variable name",
                    newVariableType: "Variable type",
                    newVariableScope: "Variable scope"
                },
                placeholder: {
                    newVariableName: "Name, e.g., display",
                    newVariableType: "Type, e.g., real"
                },
                scopeOptions: scopeOptions,
                buttons: ["Cancel", "Create variable"]
            }).on("create_variable", function (e, view) {
                console.log("add variable");
                var newVariableName = e.data.labels.get("newVariableName");
                var newVariableType = e.data.labels.get("newVariableType");
                var newVariableScope = scopeOptions[e.data.options.get("newVariableScope")];
                if (newVariableName && newVariableName.value !== ""
                        && newVariableType && newVariableType.value !== "") {
                    emuchartsManager.add_variable({
                        name: newVariableName,
                        type: newVariableType,
                        scope: newVariableScope
                    });
                    view.remove();
                }
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
            });
        });
        d3.select("#btn_menuEditVariable").on("click", function () {
            var editVariable = function (theVariable) {
                var variableScopes = emuchartsManager.getVariableScopes();
                var scopeOptions = [];
                variableScopes.forEach(function (option) {
                    if (option === theVariable.scope) {
                        scopeOptions.push({ value: option, selected: true});
                    } else {
                        scopeOptions.push({ value: option, selected: false});
                    }
                });
                displayEditVariable.create({
                    header: "Editing variable " + theVariable.name,
                    textLabel: {
                        newVariableName: "Variable name",
                        newVariableType: "Variable type",
                        newVariableScope: "Variable scope"
                    },
                    placeholder: {
                        newVariableName: theVariable.name,
                        newVariableType: theVariable.type,
                        newVariableScope: theVariable.scope
                    },
                    scopeOptions: scopeOptions,
                    buttons: ["Cancel", "Ok"]
                }).on("ok", function (e, view) {
                    var newVariableName = e.data.labels.get("newVariableName");
                    var newVariableType = e.data.labels.get("newVariableType");
                    var newVariableScope = variableScopes[e.data.options.get("newVariableScope")];
                    if (newVariableName && newVariableName.value !== ""
                            && newVariableType && newVariableType.value !== "") {
                        emuchartsManager.rename_variable(
                            theVariable.id,
                            {   name: newVariableName,
                                type: newVariableType,
                                scope: newVariableScope   }
                        );
                        view.remove();
                    }
                }).on("cancel", function (e, view) {
                    // just remove window
                    view.remove();
                });
            };

            document.getElementById("menuContext").children[1].style.display = "none";
            // step 1: ask to select the variable that needs to be edited
            var stateVariables = emuchartsManager.getVariables();
            var labels = [];
            var variables = [];
            stateVariables.forEach(function (variable) {
                labels.push(variable.name + ": " + variable.type + " (" + variable.scope + ")");
                variables.push(variable);
            });
            displaySelectVariable.create({
                header: "Edit state variable",
                message: "Please select a state variable",
                variables: labels,
                buttons: ["Cancel", "Select"]
            }).on("select", function (e, view) {
                if (variables.length > 0) {
                    var v = e.data.options.get("selectedVariable");
                    var theVariable = variables[v];
                    view.remove();
                    editVariable(theVariable);
                }
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
                return;
            });
        });

        d3.select("#btn_menuDeleteVariable").on("click", function () {
            document.getElementById("menuContext").children[1].style.display = "none";
            // step 1: ask to select the variable that needs to be edited
            var stateVariables = emuchartsManager.getVariables();
            var labels = [];
            var variables = [];
            stateVariables.forEach(function (variable) {
                labels.push(variable.name + ": " + variable.type + " (" + variable.scope + ")");
                variables.push(variable);
            });
            displaySelectVariable.create({
                header: "Delete state variable",
                message: "Please select a state variable",
                variables: labels,
                buttons: ["Cancel", "Delete Variable"]
            }).on("delete_variable", function (e, view) {
                if (variables.length > 0) {
                    var v = e.data.options.get("selectedVariable");
                    var theVariable = variables[v];
                    view.remove();
                    emuchartsManager.delete_variable(theVariable.id);
                }
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
                return;
            });
        });
        
        d3.select("#btn_menuNewConstant").on("click", function () {
            document.getElementById("menuContext").children[1].style.display = "none";
            displayAddConstant.create({
                header: "Please enter new constant...",
                textLabel: {
                    newConstantName: "Constant name",
                    newConstantType: "Constant type",
                    newConstantValue: "Constant value"
                },
                placeholder: {
                    newConstantName: "Name, e.g., maxRate",
                    newConstantType: "Type, e.g., real",
                    newConstantValue: "Value, e.g., 1200"
                },
                buttons: ["Cancel", "Create constant"]
            }).on("create_constant", function (e, view) {
                var newConstantName = e.data.labels.get("newConstantName");
                var newConstantType = e.data.labels.get("newConstantType");
                var newConstantValue = e.data.labels.get("newConstantValue");
                if (newConstantName && newConstantName.value !== ""
                        && newConstantType && newConstantType.value !== "") {
                    emuchartsManager.add_constant({
                        name: newConstantName,
                        type: newConstantType,
                        value: newConstantValue //value can be left unspecified (uninterpreted constant)
                    });
                    view.remove();
                }
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
            });
        });

        d3.select("#btn_menuEditConstant").on("click", function () {
            var editConstant = function (theConstant) {
                displayEditConstant.create({
                    header: "Editing constant " + theConstant.name,
                    textLabel: {
                        newConstantName: "Constant name",
                        newConstantType: "Constant type",
                        newConstantValue: "Constant value"
                    },
                    placeholder: {
                        newConstantName: theConstant.name,
                        newConstantType: theConstant.type,
                        newConstantValue: theConstant.value
                    },
                    buttons: ["Cancel", "Ok"]
                }).on("ok", function (e, view) {
                    var newConstantName = e.data.labels.get("newConstantName");
                    var newConstantType = e.data.labels.get("newConstantType");
                    var newConstantValue = e.data.labels.get("newConstantValue");
                    if (newConstantName && newConstantName.value !== ""
                            && newConstantType && newConstantType.value !== "") {
                        emuchartsManager.rename_constant(
                            theConstant.id,
                            {   name: newConstantName,
                                type: newConstantType,
                                value: newConstantValue   }
                        );
                        view.remove();
                    }
                }).on("cancel", function (e, view) {
                    // just remove window
                    view.remove();
                });
            };

            document.getElementById("menuContext").children[1].style.display = "none";
            // step 1: ask to select the variable that needs to be edited
            var constants = emuchartsManager.getConstants();
            var labels = [];
            constants.forEach(function (constant) {
                var l = constant.name + ": " + constant.type;
                if (constant.value) {
                    l += " = " + constant.value;
                }
                labels.push(l);
                constants.push(constant);
            });
            displaySelectConstant.create({
                header: "Edit constant",
                message: "Please select a constant",
                constants: labels,
                buttons: ["Cancel", "Select"]
            }).on("select", function (e, view) {
                if (constants.length > 0) {
                    var c = e.data.options.get("selectedConstant");
                    var theConstant = constants[c];
                    view.remove();
                    editConstant(theConstant);
                }
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
                return;
            });
        });
        
        d3.select("#btn_menuDeleteConstant").on("click", function () {
            document.getElementById("menuContext").children[1].style.display = "none";
            // step 1: ask to select the variable that needs to be edited
            var constants = emuchartsManager.getConstants();
            var labels = [];
            constants.forEach(function (constant) {
                var l = constant.name + ": " + constant.type;
                if (constant.value) {
                    l += " = " + constant.value;
                }
                labels.push(l);
                constants.push(constant);
            });
            displaySelectConstant.create({
                header: "Delete constant",
                message: "Please select a constant",
                constants: labels,
                buttons: ["Cancel", "Delete Constant"]
            }).on("delete_constant", function (e, view) {
                if (constants.length > 0) {
                    var c = e.data.options.get("selectedConstant");
                    var theConstant = constants[c];
                    view.remove();
                    emuchartsManager.delete_constant(theConstant.id);
                }
            }).on("cancel", function (e, view) {
                // just remove window
                view.remove();
                return;
            });
        });
        
        //-- Code generators menu -----------------------------------------------------------
        d3.select("#menuCodeGenenerators").on("mouseover", function () {
            document.getElementById("menuCodeGenenerators").children[1].style.display = "block";
        });
        d3.select("#btn_menuPVSPrinter").on("click", function () {
            //document.getElementById("menuCodeGenenerators").children[1].style.display = "none";
            var emucharts = {
                name: (projectManager.project().name() + "_emucharts_th"),
                author: {
                    name: "Paolo Masci",
                    affiliation: "Queen Mary University of London, United Kingdom",
                    contact: "http://www.eecs.qmul.ac.uk/~masci/"
                },
                importings: [],
                constants: emuchartsManager.getConstants(),
                variables: emuchartsManager.getVariables(),
                states: emuchartsManager.getStates(),
                transitions: emuchartsManager.getTransitions(),
                initial_transitions: emuchartsManager.getInitialTransitions()
            };
            var pvsModel = emuchartsPVSPrinter.print(emucharts);
            console.log(pvsModel);
            if (pvsModel.err) {
                console.log(pvsModel.err);
                return;
            }
            if (pvsModel.res) {
                var emuchartsFile = projectManager.createProjectFile(emucharts.name + ".pvs", pvsModel.res);
                var addFile = function (emuchartsFile) {
                    var notification = "";
                    projectManager.addFile(emuchartsFile).then(
                        function () {
                            projectManager.selectFile(emuchartsFile);
                            notification = "PVS model successfully generated in file " + emuchartsFile.path();
                            displayNotification(notification);
                            Logger.log(notification);
                        },
                        function (err) {
                            notification = "PVS Printer could not print into file " + emuchartsFile.path() + " (" + err + ")";
                            displayNotification(notification);
                            Logger.log(notification);
                        }
                    );
                };

                if (projectManager.fileExists(emuchartsFile)) {
                    // remove file from project
                    projectManager.removeFileWithPath(emuchartsFile.path())
                        .then(function (f) {
                            addFile(emuchartsFile);
                        }, function (err) {
                            console.log(err);
                        });
                } else {
                    addFile(emuchartsFile);
                }
            }
        });
        d3.select("#btn_menuPIMPrinter").on("click", function () {
            var emucharts = {
                name: "emucharts_PIM",
                author: {
                    name: "Paolo Masci",
                    affiliation: "Queen Mary University of London, United Kingdom",
                    contact: "http://www.eecs.qmul.ac.uk/~masci/"
                },
                importings: [],
                constants: emuchartsManager.getConstants(),
                variables: emuchartsManager.getVariables(),
                states: emuchartsManager.getStates(),
                transitions: emuchartsManager.getTransitions(),
                initial_transitions: emuchartsManager.getInitialTransitions()
            };
            var pimModel = emuchartsPIMPrinter.print(emucharts);
            var emuchartsFile = projectManager.createProjectFile(emucharts.name + ".tex", pimModel);
            if (projectManager.fileExists(emuchartsFile)) {
                // remove file from project
                projectManager.project().removeFile(emuchartsFile);
            }
            // add file to project
            projectManager.saveFiles([emuchartsFile], function (err) {
                var notification = "";
                if (!err) {
                    projectManager.project().addProjectFile(emuchartsFile.path(), emuchartsFile.content());
                    projectManager.selectFile(emuchartsFile);
                    notification = "PIM model successfully generated in file " + emuchartsFile.path();
                    displayNotification(notification);
                    Logger.log(notification);
                } else {
                    notification = "PVS Printer could not print into file " + emuchartsFile.path() + " (" + err + ")";
                    displayNotification(notification);
                    Logger.log(notification);
                }
            });
            // select file
            projectManager.selectFile(emuchartsFile);
        });
        d3.select("#btn_menuCppPrinter").on("click", function () {
            //document.getElementById("menuCodeGenenerators").children[1].style.display = "none";
            var emucharts = {
                name: "emucharts",
                author: {
                    name: "Paolo Masci",
                    affiliation: "Queen Mary University of London, United Kingdom",
                    contact: "http://www.eecs.qmul.ac.uk/~masci/"
                },
                importings: [],
                constants: emuchartsManager.getConstants(),
                variables: emuchartsManager.getVariables(),
                states: emuchartsManager.getStates(),
                transitions: emuchartsManager.getTransitions(),
                initial_transitions: emuchartsManager.getInitialTransitions()
            };
            var emuchartsFile = projectManager.createProjectFile(emucharts.name + ".cpp",
                                                                 emuchartsCppPrinter.print(emucharts));
            if (projectManager.fileExists(emuchartsFile)) {
                // remove file from project
                projectManager.project().removeFile(emuchartsFile);
            }
            // add file to project
            projectManager.saveFiles([emuchartsFile], function (err) {
                var notification = "";
                if (!err) {
                    projectManager.project().addProjectFile(emuchartsFile.path(), emuchartsFile.content());
                    projectManager.selectFile(emuchartsFile);
                    notification = "C++ class successfully generated in file " + emuchartsFile.path();
                    displayNotification(notification);
                    Logger.log(notification);
                } else {
                    notification = "C++ Printer could not print into file " + emuchartsFile.path() + " (" + err + ")";
                    displayNotification(notification);
                    Logger.log(notification);
                }
            });
            // select file
            projectManager.selectFile(emuchartsFile);
        });
        d3.select("#btn_menuMALPrinter").on("click", function () {
            var emucharts = {
                name: "emucharts",
                author: {
                    name: "Paolo Masci",
                    affiliation: "Queen Mary University of London, United Kingdom",
                    contact: "http://www.eecs.qmul.ac.uk/~masci/"
                },
                importings: [],
                constants: emuchartsManager.getConstants(),
                variables: emuchartsManager.getVariables(),
                states: emuchartsManager.getStates(),
                transitions: emuchartsManager.getTransitions(),
                initial_transitions: emuchartsManager.getInitialTransitions()
            };
            var emuchartsFile = projectManager.createProjectFile(emucharts.name + ".i",
                                                                 emuchartsMALPrinter.print(emucharts));
            if (projectManager.fileExists(emuchartsFile)) {
                // remove file from project
                projectManager.project().removeFile(emuchartsFile);
            }
            // add file to project
            projectManager.saveFiles([emuchartsFile], function (err) {
                var notification = "";
                if (!err) {
                    projectManager.project().addProjectFile(emuchartsFile.path(), emuchartsFile.content());
                    projectManager.selectFile(emuchartsFile);
                    notification = "MAL model successfully generated in file " + emuchartsFile.path();
                    displayNotification(notification);
                    Logger.log(notification);
                } else {
                    notification = "MAL Printer could not print into file " + emuchartsFile.path() + " (" + err + ")";
                    displayNotification(notification);
                    Logger.log(notification);
                }
            });
            // select file
            projectManager.selectFile(emuchartsFile);
        });
        //-- Zoom menu -----------------------------------------------------------
        d3.select("#menuZoom").on("mouseover", function () {
            document.getElementById("menuZoom").children[1].style.display = "block";
        });
        d3.select("#btn_menuZoomIn").on("click", function () {
            emuchartsManager.zoom_in();
            document.getElementById("menuZoom").children[1].style.display = "none";
        });
        d3.select("#btn_menuZoomOut").on("click", function () {
            emuchartsManager.zoom_out();
            document.getElementById("menuZoom").children[1].style.display = "none";
        });
        d3.select("#btn_menuZoomReset").on("click", function () {
            emuchartsManager.zoom_reset();
            document.getElementById("menuZoom").children[1].style.display = "none";
        });

	};
    
    function addProjectManagerListeners() {
        projectManager.addListener("SelectedFileChanged", function (event) {
            selectedFileChanged = event.selectedItemString;
        });
        projectManager.addListener("SelectedFileChanged", function (event) {
            selectedFileChanged = event.selectedItemString;
        });
		projectManager.addListener("ProjectSaved", function (event) {
            var project = event.project;
            var gd = stateMachine.getGraphDefinition();
            var data  = {"fileName": project.path()
                         + "/graphDefinition.json", fileContent: gd};
            ws.writeFile(data, function (err, res) {
                if (!err) { console.log("Graph Saved");
                    } else { console.log("ERROR SAVING JSON GRAPH", err); }
            });
        });
        projectManager.addListener("ProjectChanged", function (event) {
            var emulinkSvg = d3.select("#ContainerStateMachine").selectAll("svg");
            //Checking if svg has been already created, if dirty we will clear it 
            if (!emulinkSvg.empty()) {
                emulinkSvg.remove();
                stateMachine.clearSvg();
            }
            var project = event.current;
            var fileToShow = project.mainPVSFile() || project.pvsFilesList()[0];
            fileToShow = fileToShow.name();
            var f = project.path() + "/" + "graphDefinition.json";
            ws.getFile(f, function (err, res) {
                if (!err) {
                    var graphDefinitionObject = JSON.parse(res.fileContent);
                    stateMachine.restoreGraph(graphDefinitionObject,
                                              editor, ws, project,
                                              fileToShow);
				} else { ///TODO: show error loading file
					console.log(JSON.stringify(err));
                }
            });
        });
        
    }

    
    Emulink.prototype.getDependencies = function () {
        return [PrototypeBuilder.getInstance(), ModelEditor.getInstance()];
    };
    
    Emulink.prototype.initialise = function () {
        //enable the plugin -- this should also enable any dependencies defined in getDependencies method
        var prototypeBuilder = PrototypeBuilder.getInstance();
        // create local references to PVS editor, websocket client, and project manager
        editor = ModelEditor.getInstance().getEditor();
        ws = pvsioWebClient.getWebSocket();
        projectManager = ProjectManager.getInstance();
        
        // add project manager listeners
//        addProjectManagerListeners();
        // add state machine editor listener
//        stateMachine.addListener("editormodechanged", modeChange_callback);
        
        // create user interface elements
		this.createHtmlElements();
    };
    
    Emulink.prototype.unload = function () {
        PVSioWebClient.getInstance().removeCollapsiblePanel(canvas);
        canvas = null;
    };
	
	module.exports = {
        getInstance: function () {
            if (!instance) {
                instance = new Emulink();
            }
            return instance;
        }
    };
});
