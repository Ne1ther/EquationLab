/* global Office, EquationLabCommands */
// FunctionFile and task pane use the same long-lived runtime. Every click runs
// its route again; showing an existing pane never stands in for an action.
(() => {
 if(typeof Office==='undefined'||!Office.actions?.associate||typeof EquationLabCommands==='undefined')return;
 for(const command of EquationLabCommands.commands){
  Office.actions.associate(command.functionName,async event=>{
   try{
    await Office.onReady();
    if(typeof globalThis.EquationLabRunCommand!=='function')throw Error('命令尚未就绪，请重新打开 Equation Lab 面板。');
    await globalThis.EquationLabRunCommand(command.id);
   }catch(error){globalThis.EquationLabCommandError?.(error);}
   finally{event.completed();}
  });
 }
})();
